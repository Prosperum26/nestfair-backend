import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { addDays, currentWeekStart, openAtOf, toDateStr } from '../src/modules/chores/week.js';
import { ScheduleService } from '../src/modules/chores/schedule.service.js';
import { ChoreCronService } from '../src/modules/scheduler/chore-cron.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { expectDebtInvariants } from './support/debt-invariants.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

/** A2: nợ ca phải nhất quán khi ca bị đổi ngoài luồng đổi ca (override của Admin, khai vắng, xáo lại lịch). */
describe('Toàn vẹn sổ nợ ca (e2e)', () => {
  let fx: Fx;
  let events: EventsService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swap-debt-integrity.nestfair.test');
    events = fx.app.get(EventsService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const hoursFromNow = (n: number) => new Date(Date.now() + n * HOUR);
  const DEBTOR = 1; // Thiện
  const CREDITOR = 2; // Mai
  const member = (h: House, i: number) => h.memberId(h.users[i]);
  const debtRow = (id: string) => fx.prisma.choreDebt.findUniqueOrThrow({ where: { id } });
  const override = (h: House, id: string, body: object) => fx.as(h.users[0].token).patch(`/api/v1/assignments/${id}/override`, { reason: 'Trưởng phòng can thiệp', ...body });

  /** Thiện nhờ Mai làm hộ (PAYBACK). `coverDone` = Mai đã làm xong, cửa sổ chọn bù đang mở. */
  async function scenario(opts: { coverDone: boolean; pick?: boolean }) {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const cover = await makeAssignment(fx, h, { assignee: DEBTOR, dueAt: hoursFromNow(120) }, { weight: 3 });
    const created = await fx
      .as(h.users[DEBTOR].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'COVER', fromAssignmentId: cover.id, compensation: 'PAYBACK', targetMemberId: member(h, CREDITOR), acknowledgedWarnings: ['WEIGHT_GAP'] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await fx.as(h.users[CREDITOR].token).patch(`/api/v1/swaps/${created.body.id}/accept`).set('Idempotency-Key', randomUUID()).expect(200);
    const debt = await fx.prisma.choreDebt.findFirstOrThrow({ where: { houseId: h.houseId } });
    const pickDeadlineAt = hoursFromNow(47);
    let payback: Awaited<ReturnType<typeof makeAssignment>> | null = null;
    if (opts.coverDone) {
      await fx.prisma.choreAssignment.update({ where: { id: cover.id }, data: { status: 'DONE' } });
      await fx.prisma.choreDebt.update({ where: { id: debt.id }, data: { pickOpensAt: hoursFromNow(-1), pickDeadlineAt } });
    }
    if (opts.pick) {
      const nextWeek = addDays(toDateStr(cover.weekStart), 7);
      payback = await makeAssignment(
        fx,
        h,
        { assignee: CREDITOR, occurrenceDate: addDays(nextWeek, 2), dueAt: new Date(pickDeadlineAt.getTime() + 24 * HOUR) },
        { weight: 3, title: 'Ca bù' },
      );
      await fx.as(h.users[CREDITOR].token).patch(`/api/v1/chore-debts/${debt.id}/payback`, { assignmentId: payback.id }).set('Idempotency-Key', randomUUID()).expect(200);
    }
    return { h, cover, debtId: debt.id, payback };
  }

  describe('Admin override (b)', () => {
    it('REASSIGN ca bù cho người khác: nợ vẫn trỏ ca đó; người đó làm xong cũng KHÔNG đóng nợ (PAID sai người)', async () => {
      const s = await scenario({ coverDone: true, pick: true });
      await expectDebtInvariants(fx, s.h.houseId, 'sau khi chọn');
      await override(s.h, s.payback!.id, { action: 'REASSIGN', userId: s.h.users[0].id }).expect(200);
      expect((await debtRow(s.debtId)).paybackAssignmentId).toBe(s.payback!.id);

      // Hùng (người mới giữ ca) làm xong, Thiện duyệt.
      await fx.prisma.choreAssignment.update({ where: { id: s.payback!.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
      await fx.as(s.h.users[DEBTOR].token).patch(`/api/v1/assignments/${s.payback!.id}/verify`, { decision: 'APPROVED' }).expect(200);
      expect(await debtRow(s.debtId)).toMatchObject({ status: 'OPEN', settledAt: null });
    });

    it('REASSIGN ca bù rồi người mới làm xong: nợ không kẹt, ca bù được thả và cửa sổ chọn bù mở lại 48 giờ (B4)', async () => {
      const s = await scenario({ coverDone: true, pick: true });
      await override(s.h, s.payback!.id, { action: 'REASSIGN', userId: s.h.users[0].id }).expect(200);
      const before = await debtRow(s.debtId);
      await fx.prisma.choreAssignment.update({ where: { id: s.payback!.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
      const send = vi.spyOn(events, 'send');
      await fx.as(s.h.users[DEBTOR].token).patch(`/api/v1/assignments/${s.payback!.id}/verify`, { decision: 'APPROVED' }).expect(200);

      const after = await debtRow(s.debtId);
      expect(after).toMatchObject({ status: 'OPEN', paybackAssignmentId: null, pickAttempts: before.pickAttempts });
      expect(after.pickOpensAt!.getTime()).toBeLessThanOrEqual(Date.now());
      expect(after.pickDeadlineAt!.getTime() - after.pickOpensAt!.getTime()).toBe(48 * HOUR);
      const picks = send.mock.calls.filter((c) => (c[1] as { type: string }).type === 'chore_debt:pick_requested');
      expect(picks.map((c) => c[0])).toEqual([`user:${s.h.users[CREDITOR].id}`]);
      await expectDebtInvariants(fx, s.h.houseId, 'sau REASSIGN ca bù rồi DONE');
    });

    it('REASSIGN ca bù rồi người mới bỏ lỡ: không tính lượt chọn của người nợ, nợ mở lại để chọn (B4)', async () => {
      const s = await scenario({ coverDone: true, pick: true });
      await override(s.h, s.payback!.id, { action: 'REASSIGN', userId: s.h.users[0].id }).expect(200);
      const before = await debtRow(s.debtId);
      await fx.prisma.choreAssignment.update({ where: { id: s.payback!.id }, data: { dueAt: new Date(Date.now() - 5 * HOUR) } });
      await fx.app.get(ChoreCronService).markMissed(new Date(), [s.h.houseId]);

      const after = await debtRow(s.debtId);
      expect(after).toMatchObject({ status: 'OPEN', paybackAssignmentId: null, pickAttempts: before.pickAttempts });
      expect(after.pickOpensAt!.getTime()).toBeLessThanOrEqual(Date.now());
      expect(after.pickDeadlineAt!.getTime() - after.pickOpensAt!.getTime()).toBe(48 * HOUR);
      await expectDebtInvariants(fx, s.h.houseId, 'sau REASSIGN ca bù rồi MISSED');
    });

    it('người nợ tự làm ca bù thì vẫn đóng nợ PAID như cũ', async () => {
      const s = await scenario({ coverDone: true, pick: true });
      await fx.prisma.choreAssignment.update({ where: { id: s.payback!.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
      await fx.as(s.h.users[0].token).patch(`/api/v1/assignments/${s.payback!.id}/verify`, { decision: 'APPROVED' }).expect(200);
      expect((await debtRow(s.debtId)).status).toBe('PAID');
    });

    it('CANCEL ca bù: nợ quay về OPEN chưa có ca bù, pickAttempts không đổi, creditor được mời chọn lại', async () => {
      const s = await scenario({ coverDone: true, pick: true });
      const before = await debtRow(s.debtId);
      const send = vi.spyOn(events, 'send');
      await override(s.h, s.payback!.id, { action: 'CANCEL' }).expect(200);

      const after = await debtRow(s.debtId);
      expect(after).toMatchObject({ status: 'OPEN', paybackAssignmentId: null, pickAttempts: before.pickAttempts });
      expect(after.pickOpensAt!.getTime()).toBeLessThanOrEqual(Date.now());
      expect(after.pickDeadlineAt!.getTime() - after.pickOpensAt!.getTime()).toBe(48 * HOUR);
      const picks = send.mock.calls.filter((c) => (c[1] as { type: string }).type === 'chore_debt:pick_requested');
      expect(picks.map((c) => c[0])).toEqual([`user:${s.h.users[CREDITOR].id}`]);
      await expectDebtInvariants(fx, s.h.houseId, 'sau CANCEL ca bù');
    });

    it('CANCEL ca gốc được làm hộ: nợ đóng CANCELLED (COVER_MISSED), không kẹt OPEN', async () => {
      const s = await scenario({ coverDone: false });
      await override(s.h, s.cover.id, { action: 'CANCEL' }).expect(200);
      expect(await debtRow(s.debtId)).toMatchObject({ status: 'CANCELLED', closeReason: 'COVER_MISSED' });
    });

    it('REASSIGN ca gốc được làm hộ: nợ đóng CANCELLED (ADMIN_REASSIGN)', async () => {
      const s = await scenario({ coverDone: false });
      await override(s.h, s.cover.id, { action: 'REASSIGN', userId: s.h.users[0].id }).expect(200);
      expect(await debtRow(s.debtId)).toMatchObject({ status: 'CANCELLED', closeReason: 'ADMIN_REASSIGN' });
    });
  });

  describe('Tắt việc và kỳ nghỉ cả nhà (A1)', () => {
    const patchChore = (h: House, choreId: string, body: object) => fx.as(h.users[0].token).patch(`/api/v1/houses/${h.houseId}/chores/${choreId}`, body);

    it('tắt việc của ca bù đã chọn: ca bị hủy, nợ mở lại để chọn (không trỏ vào ca đã hủy)', async () => {
      const s = await scenario({ coverDone: true, pick: true });
      await expectDebtInvariants(fx, s.h.houseId, 'trước khi tắt việc');
      const send = vi.spyOn(events, 'send');
      await patchChore(s.h, s.payback!.choreId, { isActive: false }).expect(200);

      expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: s.payback!.id } })).status).toBe('CANCELLED');
      const d = await debtRow(s.debtId);
      expect(d).toMatchObject({ status: 'OPEN', paybackAssignmentId: null });
      expect(d.pickOpensAt).not.toBeNull();
      expect(d.pickDeadlineAt!.getTime() - d.pickOpensAt!.getTime()).toBe(48 * HOUR);
      await expectDebtInvariants(fx, s.h.houseId, 'sau khi tắt việc');
      const picks = send.mock.calls.filter((c) => (c[1] as { type: string }).type === 'chore_debt:pick_requested');
      expect(picks.map((c) => c[0])).toEqual([`user:${s.h.users[CREDITOR].id}`]);
    });

    it('tắt việc của ca được làm hộ (còn TODO): nợ bị hủy (COVER_MISSED), không kẹt WAITING_COVER', async () => {
      const s = await scenario({ coverDone: false });
      await patchChore(s.h, s.cover.choreId, { isActive: false }).expect(200);
      expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: s.cover.id } })).status).toBe('CANCELLED');
      expect(await debtRow(s.debtId)).toMatchObject({ status: 'CANCELLED', closeReason: 'COVER_MISSED' });
    });

    it('tạo kỳ nghỉ cả nhà chứa ngày của ca bù: ca bị hủy, nợ mở lại để chọn', async () => {
      const s = await scenario({ coverDone: true, pick: true });
      const date = toDateStr(s.payback!.occurrenceDate);
      await fx.as(s.h.users[0].token).post(`/api/v1/houses/${s.h.houseId}/breaks`, { startDate: date, endDate: date }).expect(201);
      expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: s.payback!.id } })).status).toBe('CANCELLED');
      expect(await debtRow(s.debtId)).toMatchObject({ status: 'OPEN', paybackAssignmentId: null });
      await expectDebtInvariants(fx, s.h.houseId, 'sau kỳ nghỉ');
    });
  });

  describe('Khai vắng (c)', () => {
    it('người nợ khai vắng đúng ngày ca bù: ca bù được dời cho người khác, nợ mở lại để chọn, không PAID sai người', async () => {
      const s = await scenario({ coverDone: true, pick: true });
      const date = toDateStr(s.payback!.occurrenceDate);
      await fx.as(s.h.users[DEBTOR].token).post(`/api/v1/houses/${s.h.houseId}/absences`, { startDate: date, endDate: date }).expect(201);

      const slot = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: s.payback!.id } });
      expect(slot.assigneeId).not.toBe(member(s.h, DEBTOR));
      const debt = await debtRow(s.debtId);
      expect(debt).toMatchObject({ status: 'OPEN', paybackAssignmentId: null });
      expect(debt.pickOpensAt).not.toBeNull();
      await expectDebtInvariants(fx, s.h.houseId, 'sau khai vắng');

      // Người mới giữ ca làm xong cũng không đóng nợ.
      await fx.prisma.choreAssignment.update({ where: { id: slot.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
      const verifier = s.h.users.findIndex((u) => s.h.memberId(u) !== slot.assigneeId);
      await fx.as(s.h.users[verifier].token).patch(`/api/v1/assignments/${slot.id}/verify`, { decision: 'APPROVED' }).expect(200);
      expect((await debtRow(s.debtId)).status).toBe('OPEN');
    });
  });

  describe('Xáo lại lịch (a)', () => {
    const cur = currentWeekStart();
    const next = addDays(cur, 7);
    const monday = openAtOf(cur);
    const ALL = ['A', 'B', 'C', 'D'];

    async function houseWithSchedule() {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
      for (const title of ALL) await fx.prisma.chore.create({ data: { houseId: h.houseId, title, weight: 2, recurrenceDays: [7], dueTime: '21:00' } });
      const schedule = fx.app.get(ScheduleService);
      await schedule.createSchedule(h.houseId, next, monday);
      const admin = { memberId: member(h, 0), role: 'ADMIN' as const };
      return { h, schedule, admin };
    }

    /** Cho slot `slot` (của creditor) thành ca bù đã chọn của một nợ OPEN: do `debtor` giữ, source PAYBACK. */
    async function makePayback(h: House, slotId: string, debtorMemberId: string) {
      const slot = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slotId } });
      const creditor = slot.assigneeId!;
      await fx.prisma.choreAssignment.update({ where: { id: slotId }, data: { assigneeId: debtorMemberId, source: 'PAYBACK', originalAssigneeId: creditor } });
      return fx.prisma.choreDebt.create({
        data: { houseId: h.houseId, debtorMemberId, creditorMemberId: creditor, swapRequestId: randomUUID(), coverAssignmentId: randomUUID(), weight: slot.weightSnapshot, paybackAssignmentId: slotId, pickOpensAt: new Date(Date.now() - HOUR), pickDeadlineAt: new Date(Date.now() + HOUR) },
      });
    }

    it('xáo lại lịch có ca bù đã chọn: ca bù vẫn nằm trên lịch mới cho đúng người nợ, nợ trỏ đúng ca đó', async () => {
      const { h, schedule, admin } = await houseWithSchedule();
      const rows = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId } });
      const target = rows[0];
      const debtor = rows.find((r) => r.assigneeId !== target.assigneeId)!.assigneeId!;
      const debt = await makePayback(h, target.id, debtor);
      await expectDebtInvariants(fx, h.houseId, 'trước xáo');

      for (let i = 0; i < 2; i++) {
        const res = await schedule.rerollSchedule(h.houseId, next, admin, monday);
        expect(res.changed).toBe(true);
        const d = await debtRow(debt.id);
        expect(d.status).toBe('OPEN');
        expect(d.paybackAssignmentId).not.toBeNull();
        const slot = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: d.paybackAssignmentId! } });
        expect(slot).toMatchObject({ choreId: target.choreId, assigneeId: debtor, source: 'PAYBACK', status: 'TODO', originalAssigneeId: debt.creditorMemberId });
        expect(slot.occurrenceDate).toEqual(target.occurrenceDate);
        expect(slot.scheduleId).toBe(res.schedule.id);
        await expectDebtInvariants(fx, h.houseId, `sau xáo ${i + 1}`);
      }
    });

    it('người nợ vắng đúng ngày ca bù nên không ghim được: nợ mở lại để chọn, không trỏ vào ca đã mất', async () => {
      const { h, schedule, admin } = await houseWithSchedule();
      const rows = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId } });
      const target = rows[0];
      const debtorRow = rows.find((r) => r.assigneeId !== target.assigneeId)!;
      const debt = await makePayback(h, target.id, debtorRow.assigneeId!);
      const debtorUser = h.users.find((u) => h.memberId(u) === debtorRow.assigneeId)!;
      await fx.prisma.memberAbsence.create({
        data: { houseId: h.houseId, userId: debtorUser.id, startDate: target.occurrenceDate, endDate: target.occurrenceDate, createdById: debtorUser.id },
      });

      const res = await schedule.rerollSchedule(h.houseId, next, admin, monday);
      expect(res.changed).toBe(true);
      const d = await debtRow_(debt.id);
      expect(d).toMatchObject({ status: 'OPEN', paybackAssignmentId: null });
      expect(d.pickOpensAt).not.toBeNull();
      await expectDebtInvariants(fx, h.houseId, 'sau xáo (người nợ vắng)');
    });

    it('xáo lại lịch có ca được làm hộ (COVER) của nợ OPEN: ca vẫn do người làm hộ giữ, nợ trỏ đúng ca mới', async () => {
      const { h, schedule, admin } = await houseWithSchedule();
      const rows = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId } });
      const cover = rows[0];
      const debtorMember = rows.find((r) => r.assigneeId !== cover.assigneeId)!.assigneeId!;
      await fx.prisma.choreAssignment.update({ where: { id: cover.id }, data: { source: 'COVER', originalAssigneeId: debtorMember } });
      const debt = await fx.prisma.choreDebt.create({
        data: { houseId: h.houseId, debtorMemberId: debtorMember, creditorMemberId: cover.assigneeId!, swapRequestId: randomUUID(), coverAssignmentId: cover.id, weight: cover.weightSnapshot },
      });

      const res = await schedule.rerollSchedule(h.houseId, next, admin, monday);
      expect(res.changed).toBe(true);
      const d = await debtRow_(debt.id);
      expect(d.status).toBe('OPEN');
      const slot = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: d.coverAssignmentId } });
      expect(slot).toMatchObject({ choreId: cover.choreId, assigneeId: cover.assigneeId, source: 'COVER', originalAssigneeId: debtorMember });
    });

    const debtRow_ = debtRow;
  });
});

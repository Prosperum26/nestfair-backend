import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { ChoreDebtService } from '../src/modules/swaps/chore-debt.service.js';
import { ScheduleService } from '../src/modules/chores/schedule.service.js';
import { ChoreCronService } from '../src/modules/scheduler/chore-cron.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { addDays, currentWeekStart, toDateStr } from '../src/modules/chores/week.js';
import { dateOf, HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

describe('Sổ nợ ca (e2e)', () => {
  let fx: Fx;
  let events: EventsService;
  let debts: ChoreDebtService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swap-debts.nestfair.test');
    events = fx.app.get(EventsService);
    debts = fx.app.get(ChoreDebtService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const inDays = (n: number) => new Date(Date.now() + n * 24 * HOUR);
  const member = (h: House, i: number) => h.memberId(h.users[i]);

  /** Nợ cũ chèn thẳng DB: `debtor` đang nợ `creditor` `weight` điểm. */
  const oldDebt = async (h: House, debtor: number, creditor: number, weight: number, extra: object = {}, coverStatus: 'DONE' | 'TODO' | 'MISSED' = 'DONE') => {
    // Ca gốc thật của nợ cũ (D17: chỉ nợ có ca gốc DONE mới bị cấn trừ); mặc định đã DONE.
    const cover = 'coverAssignmentId' in extra ? null : await makeAssignment(fx, h, { assignee: creditor, status: coverStatus }, { weight });
    return fx.prisma.choreDebt.create({
      data: {
        houseId: h.houseId,
        debtorMemberId: member(h, debtor),
        creditorMemberId: member(h, creditor),
        swapRequestId: randomUUID(),
        coverAssignmentId: cover?.id ?? randomUUID(),
        weight,
        ...extra,
      },
    });
  };

  /** `requester` nhờ `target` làm hộ một ca `weight` điểm bằng PAYBACK, `target` chấp nhận. */
  async function coverPayback(h: House, requester: number, target: number, weight: number) {
    const slot = await makeAssignment(fx, h, { assignee: requester, dueAt: inDays(5) }, { weight });
    const created = await fx
      .as(h.users[requester].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'COVER', fromAssignmentId: slot.id, compensation: 'PAYBACK', targetMemberId: member(h, target), acknowledgedWarnings: ['WEIGHT_GAP'] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    const done = await fx.as(h.users[target].token).patch(`/api/v1/swaps/${created.body.id}/accept`).set('Idempotency-Key', randomUUID()).expect(200);
    return { slot, swapId: created.body.id as string, done: done.body };
  }
  const debtsOf = (h: House) => fx.prisma.choreDebt.findMany({ where: { houseId: h.houseId }, orderBy: { createdAt: 'asc' } });

  describe('cấn trừ ngược chiều (R-SWAP-7, D17: chỉ có hiệu lực khi ca gốc DONE)', () => {
    /** Người làm hộ nộp ảnh, người khác (người nhờ) duyệt: ca gốc DONE. */
    async function finishCover(h: House, slotId: string, verifier: number) {
      await fx.prisma.choreAssignment.update({ where: { id: slotId }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
      await fx.as(h.users[verifier].token).patch(`/api/v1/assignments/${slotId}/verify`, { decision: 'APPROVED' }).expect(200);
    }
    const byId = async (h: House) => new Map((await debtsOf(h)).map((d) => [d.id, d]));

    it('net > 0: accept chưa đụng nợ cũ; khi ca gốc DONE nợ cũ PAID (OFFSET), nợ mới còn weight = net', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
      // Mai (2) đang nợ Quân (3) 3 điểm; Quân nhờ Mai làm hộ ca 4 điểm.
      const old = await oldDebt(h, 2, 3, 3);
      const { slot, swapId } = await coverPayback(h, 3, 2, 4);

      const afterAccept = await byId(h);
      expect(afterAccept.size).toBe(2);
      expect(afterAccept.get(old.id)).toMatchObject({ status: 'OPEN', weight: 3, closeReason: null });
      const fresh = [...afterAccept.values()].find((d) => d.id !== old.id)!;
      expect(fresh).toMatchObject({ status: 'OPEN', weight: 4, debtorMemberId: member(h, 3), creditorMemberId: member(h, 2) });
      expect((await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: swapId } })).offsetDebtId).toBeNull();

      await finishCover(h, slot.id, 3);
      const afterDone = await byId(h);
      expect(afterDone.get(old.id)).toMatchObject({ status: 'PAID', closeReason: 'OFFSET' });
      expect(afterDone.get(old.id)!.settledAt).not.toBeNull();
      expect(afterDone.get(fresh.id)).toMatchObject({ status: 'OPEN', weight: 1 });
      expect((await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: swapId } })).offsetDebtId).toBe(old.id);
    });

    it('net = 0: khi ca gốc DONE cả nợ cũ lẫn nợ mới đóng PAID (OFFSET), không còn nợ mở', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const old = await oldDebt(h, 1, 0, 3);
      const { slot } = await coverPayback(h, 0, 1, 3);
      expect((await byId(h)).get(old.id)!.status).toBe('OPEN');
      await finishCover(h, slot.id, 0);
      const rows = [...(await byId(h)).values()];
      expect(rows).toHaveLength(2);
      expect(rows.every((d) => d.status === 'PAID' && d.closeReason === 'OFFSET')).toBe(true);
    });

    it('net < 0: khi ca gốc DONE nợ cũ giảm còn |net| (vẫn OPEN), nợ mới đóng PAID (OFFSET)', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const old = await oldDebt(h, 1, 0, 3);
      const { slot } = await coverPayback(h, 0, 1, 2);
      expect((await byId(h)).get(old.id)).toMatchObject({ status: 'OPEN', weight: 3 });
      await finishCover(h, slot.id, 0);
      const map = await byId(h);
      expect(map.get(old.id)).toMatchObject({ status: 'OPEN', weight: 1 });
      const fresh = [...map.values()].find((d) => d.id !== old.id)!;
      expect(fresh).toMatchObject({ status: 'PAID', closeReason: 'OFFSET' });
    });

    it('ca gốc bị MISSED: không cấn trừ, nợ cũ vẫn OPEN nguyên vẹn, nợ mới bị hủy', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
      const old = await oldDebt(h, 2, 3, 3);
      const { slot } = await coverPayback(h, 3, 2, 4);
      await fx.prisma.choreAssignment.update({ where: { id: slot.id }, data: { dueAt: new Date(Date.now() - 5 * HOUR) } });
      expect(await fx.app.get(ChoreCronService).markMissed(new Date(), [h.houseId])).toBe(1);
      const map = await byId(h);
      expect(map.get(old.id)).toMatchObject({ status: 'OPEN', weight: 3, closeReason: null });
      expect([...map.values()].find((d) => d.id !== old.id)).toMatchObject({ status: 'CANCELLED', closeReason: 'COVER_MISSED' });
    });

    it('nợ cũ mà ca gốc của nó chưa DONE thì không bị cấn trừ; khi ca đó MISSED chỉ nợ cũ bị hủy (A2)', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
      // Mai (2) đang nợ Quân (3), nhưng ca Mai nhờ Quân làm hộ (Y) vẫn TODO.
      const old = await oldDebt(h, 2, 3, 3, {}, 'TODO');
      const oldCover = old.coverAssignmentId;
      const { slot } = await coverPayback(h, 3, 2, 4);
      await finishCover(h, slot.id, 3);
      const map = await byId(h);
      const fresh = [...map.values()].find((d) => d.id !== old.id)!;
      expect(map.get(old.id)).toMatchObject({ status: 'OPEN', weight: 3, closeReason: null });
      expect(fresh).toMatchObject({ status: 'OPEN', weight: 4 });
      expect((await fx.prisma.choreSwapRequest.findFirstOrThrow({ where: { id: fresh.swapRequestId } })).offsetDebtId).toBeNull();

      // Y bị MISSED: chỉ nợ cũ bị hủy, nợ mới giữ nguyên.
      await fx.prisma.choreAssignment.update({ where: { id: oldCover }, data: { dueAt: new Date(Date.now() - 5 * HOUR) } });
      await fx.app.get(ChoreCronService).markMissed(new Date(), [h.houseId]);
      const after = await byId(h);
      expect(after.get(old.id)).toMatchObject({ status: 'CANCELLED', closeReason: 'COVER_MISSED' });
      expect(after.get(fresh.id)).toMatchObject({ status: 'OPEN', weight: 4 });
    });

    it('ca gốc bị Admin CANCEL: không cấn trừ, nợ cũ vẫn OPEN', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const old = await oldDebt(h, 1, 2, 3);
      const { slot } = await coverPayback(h, 2, 1, 4);
      await fx.as(h.users[0].token).patch(`/api/v1/assignments/${slot.id}/override`, { action: 'CANCEL', reason: 'Hủy ca gốc' }).expect(200);
      const map = await byId(h);
      expect(map.get(old.id)).toMatchObject({ status: 'OPEN', weight: 3 });
      expect([...map.values()].find((d) => d.id !== old.id)!.status).toBe('CANCELLED');
    });

    it('nhiều nợ cũ: khi ca gốc DONE cấn trừ cũ nhất trước', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const first = await oldDebt(h, 1, 0, 2, { createdAt: new Date(Date.now() - 3 * 24 * HOUR) });
      const second = await oldDebt(h, 1, 0, 2, { createdAt: new Date(Date.now() - 1 * 24 * HOUR) });
      const { slot } = await coverPayback(h, 0, 1, 3);
      await finishCover(h, slot.id, 0);
      const map = await byId(h);
      expect(map.get(first.id)).toMatchObject({ status: 'PAID', closeReason: 'OFFSET' });
      // 3 điểm mới: trừ hết nợ cũ nhất (2), còn 1 điểm trừ vào nợ kế tiếp (2 → 1); nợ mới đóng.
      expect(map.get(second.id)).toMatchObject({ status: 'OPEN', weight: 1 });
      expect(map.size).toBe(3);
      expect([...map.values()].find((d) => d.id !== first.id && d.id !== second.id)).toMatchObject({ status: 'PAID', closeReason: 'OFFSET' });
    });

    it('nợ cũ đã có ca bù được chọn trước khi ca gốc DONE thì không cấn trừ, nợ mới giữ đủ weight', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const old = await oldDebt(h, 1, 0, 3, { paybackAssignmentId: randomUUID() });
      const { slot } = await coverPayback(h, 0, 1, 3);
      await finishCover(h, slot.id, 0);
      const rows = await debtsOf(h);
      expect(rows).toHaveLength(2);
      expect(rows.find((d) => d.id === old.id)).toMatchObject({ status: 'OPEN', weight: 3 });
      expect(rows.find((d) => d.id !== old.id)).toMatchObject({ status: 'OPEN', weight: 3, debtorMemberId: member(h, 0), creditorMemberId: member(h, 1) });
    });

    it('nợ cùng chiều (người nhận không nợ người nhờ) không bị đụng tới', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const sameWay = await oldDebt(h, 0, 1, 2); // Hùng nợ Thiện; Hùng lại nhờ Thiện
      const { slot } = await coverPayback(h, 0, 1, 2);
      await finishCover(h, slot.id, 0);
      const rows = await debtsOf(h);
      expect(rows).toHaveLength(2);
      expect(rows.find((d) => d.id === sameWay.id)).toMatchObject({ status: 'OPEN', weight: 2 });
      expect(rows.find((d) => d.id !== sameWay.id)).toMatchObject({ status: 'OPEN', weight: 2 });
    });
  });

  describe('cửa sổ chọn bù (DB-01)', () => {
    /** Lịch tuần kế của ca gốc đã được sinh vào `createdAt`. */
    async function nextSchedule(h: House, slotWeekStart: Date, createdAt: Date) {
      const weekStart = addDays(toDateStr(slotWeekStart), 7);
      return fx.prisma.weekSchedule.create({
        data: { houseId: h.houseId, weekStart: dateOf(weekStart), weekKey: 'test-next', status: 'PUBLISHED', generatedBy: 'CRON', seed: 1, attempts: 1, fenceWeeksApplied: 3, loadSnapshot: {}, algoVersion: 'test', createdAt },
      });
    }

    it('nợ OPEN khi ca gốc chưa DONE (chưa có cửa sổ); khi duyệt DONE thì pickOpensAt và pickDeadlineAt được đặt', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const { slot } = await coverPayback(h, 0, 1, 3);
      const sched = await nextSchedule(h, slot.weekStart, new Date(Date.now() - 2 * HOUR));
      const before = (await debtsOf(h))[0];
      expect(before).toMatchObject({ status: 'OPEN', pickOpensAt: null, pickDeadlineAt: null });

      // Thiện (người làm hộ) nộp ảnh; Mai duyệt.
      await fx.prisma.choreAssignment.update({ where: { id: slot.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
      const send = vi.spyOn(events, 'send');
      const t0 = Date.now();
      await fx.as(h.users[2].token).patch(`/api/v1/assignments/${slot.id}/verify`, { decision: 'APPROVED' }).expect(200);

      const after = (await debtsOf(h))[0];
      // pickOpensAt = max(lịch tuần kế được sinh, bây giờ) = bây giờ.
      expect(after.pickOpensAt!.getTime()).toBeGreaterThanOrEqual(t0 - 1000);
      expect(after.pickOpensAt!.getTime()).toBeGreaterThan(sched.createdAt.getTime());
      expect(after.pickDeadlineAt!.getTime() - after.pickOpensAt!.getTime()).toBe(48 * HOUR);
      const pickEvents = send.mock.calls.filter((c) => (c[1] as { type: string }).type === 'chore_debt:pick_requested');
      expect(pickEvents.map((c) => c[0])).toEqual([`user:${h.users[1].id}`]);
    });

    it('lịch tuần kế sinh sau ca gốc DONE: pickOpensAt = lúc lịch được sinh', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const { slot } = await coverPayback(h, 0, 1, 3);
      await fx.prisma.choreAssignment.update({ where: { id: slot.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
      await fx.as(h.users[2].token).patch(`/api/v1/assignments/${slot.id}/verify`, { decision: 'APPROVED' }).expect(200);
      expect((await debtsOf(h))[0].pickOpensAt).toBeNull(); // chưa có lịch tuần kế

      const createdAt = new Date(Date.now() + 3 * HOUR);
      const sched = await nextSchedule(h, slot.weekStart, createdAt);
      await fx.prisma.$transaction((tx) => debts.openWindowsForNewSchedule(tx, events.outbox(), h.houseId, sched.weekStart, sched.createdAt));
      const d = (await debtsOf(h))[0];
      expect(d.pickOpensAt).toEqual(createdAt);
      expect(d.pickDeadlineAt).toEqual(new Date(createdAt.getTime() + 48 * HOUR));
    });

    it('B5: lịch tuần sau được sinh khi ca gốc đã DONE → mở cửa sổ và phát chore_debt:pick_requested tới creditor (đường cron và đường sinh bù)', async () => {
      for (const via of ['ensureSchedule', 'cron'] as const) {
        const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
        for (const title of ['A', 'B', 'C', 'D']) {
          await fx.prisma.chore.create({ data: { houseId: h.houseId, title, weight: 2, recurrenceDays: [7], dueTime: '21:00' } });
        }
        // Ca gốc (Mai làm hộ Thiện) thuộc tuần hiện tại, đã DONE; lịch tuần sau chưa có.
        const monday = currentWeekStart();
        const cover = await makeAssignment(fx, h, { assignee: 2, status: 'DONE', occurrenceDate: monday, dueAt: new Date(`${monday}T12:00:00Z`) }, { weight: 3 });
        const d = await oldDebt(h, 1, 2, 3, { coverAssignmentId: cover.id });
        expect(d.pickOpensAt).toBeNull();

        const send = vi.spyOn(events, 'send');
        const next = addDays(monday, 7);
        if (via === 'ensureSchedule') await fx.app.get(ScheduleService).ensureSchedule(h.houseId, next, 'CRON');
        else await fx.app.get(ChoreCronService).generateNextWeek(new Date(), [h.houseId]);

        const after = await fx.prisma.choreDebt.findUniqueOrThrow({ where: { id: d.id } });
        const sched = await fx.prisma.weekSchedule.findFirstOrThrow({ where: { houseId: h.houseId, weekStart: dateOf(next) } });
        expect(after.pickOpensAt).toEqual(sched.createdAt);
        expect(after.pickDeadlineAt!.getTime() - after.pickOpensAt!.getTime()).toBe(48 * HOUR);
        const pick = send.mock.calls.filter((c) => (c[1] as { type: string }).type === 'chore_debt:pick_requested');
        expect(pick.map((c) => c[0]), via).toEqual([`user:${h.users[2].id}`]);
        vi.restoreAllMocks();
      }
    });

    it('Admin FORCE_DONE ca gốc cũng mở cửa sổ', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const { slot } = await coverPayback(h, 1, 2, 2);
      await nextSchedule(h, slot.weekStart, new Date(Date.now() - HOUR));
      await fx.prisma.choreAssignment.update({ where: { id: slot.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
      await fx.as(h.users[0].token).patch(`/api/v1/assignments/${slot.id}/override`, { action: 'FORCE_DONE', reason: 'Đã thấy làm xong' }).expect(200);
      expect((await debtsOf(h))[0].pickOpensAt).not.toBeNull();
    });

    it('ca không phải ca gốc của nợ nào thì verify như cũ, không động tới sổ nợ', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const plain = await makeAssignment(fx, h, { assignee: 0, status: 'PENDING_VERIFY', submittedAt: new Date() });
      await oldDebt(h, 1, 0, 2);
      await fx.as(h.users[1].token).patch(`/api/v1/assignments/${plain.id}/verify`, { decision: 'APPROVED' }).expect(200);
      expect((await debtsOf(h))[0].pickOpensAt).toBeNull();
    });
  });

  describe('GET /houses/:houseId/chore-debts (gom theo cặp người có hướng)', () => {
    const day = (n: number) => new Date(Date.now() - n * 24 * HOUR);
    const get = (h: House, i: number, scope = 'all') => fx.as(h.users[i].token).get(`/api/v1/houses/${h.houseId}/chore-debts?scope=${scope}`);
    const groupOf = (body: any, debtor: string, creditor: string) => body.groups.find((g: any) => g.debtorMemberId === debtor && g.creditorMemberId === creditor);

    it('hai chiều nợ giữa cùng hai người → hai nhóm khác nhau, mỗi nhóm có openWeight đúng, không bù trừ ròng', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      await oldDebt(h, 0, 1, 2, { createdAt: day(5) }, 'TODO'); // Hùng nợ Thiện 2
      await oldDebt(h, 0, 1, 3, { createdAt: day(4) }); // Hùng nợ Thiện 3
      await oldDebt(h, 1, 0, 1, { createdAt: day(3) }); // Thiện nợ Hùng 1
      const res = await get(h, 2).expect(200);
      expect(res.body.truncated).toBe(false);
      expect(res.body.groups).toHaveLength(2);
      const hungThien = groupOf(res.body, member(h, 0), member(h, 1));
      const thienHung = groupOf(res.body, member(h, 1), member(h, 0));
      expect(hungThien).toMatchObject({ debtorName: 'Hùng', creditorName: 'Thiện', openWeight: 5 });
      expect(hungThien.debts).toHaveLength(2);
      expect(thienHung).toMatchObject({ debtorName: 'Thiện', creditorName: 'Hùng', openWeight: 1 });
      expect(thienHung.debts).toHaveLength(1);
      // Mỗi phần tử trong nhóm vẫn là DebtDto nguyên dạng.
      expect(hungThien.debts[0]).toMatchObject({ weight: 2, status: 'OPEN', phase: 'WAITING_COVER', debtorName: 'Hùng', creditorName: 'Thiện' });
      expect(Object.keys(hungThien.debts[0]).sort()).toEqual(
        ['closeReason', 'coverAssignment', 'createdAt', 'creditorMemberId', 'creditorName', 'debtorMemberId', 'debtorName', 'id', 'paybackAssignmentId', 'phase', 'pickAttempts', 'pickDeadlineAt', 'pickOpensAt', 'settledAt', 'status', 'weight'].sort(),
      );
    });

    it('B6: DebtDto trả closeReason và settledAt (null với nợ OPEN, có giá trị với nợ đã đóng)', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const settled = day(3);
      await oldDebt(h, 0, 1, 2, { createdAt: day(5) });
      await oldDebt(h, 0, 1, 1, { createdAt: day(6), status: 'PAID', closeReason: 'OFFSET', settledAt: settled });
      await oldDebt(h, 0, 1, 1, { createdAt: day(7), status: 'FORGIVEN', closeReason: 'STALE', settledAt: day(2) });
      const debts = (await get(h, 0, 'mine').expect(200)).body.groups[0].debts;
      expect(debts[0]).toMatchObject({ status: 'OPEN', closeReason: null, settledAt: null });
      // Sau OPEN: theo createdAt tăng dần, nên khoản tạo cũ hơn (FORGIVEN) đứng trước.
      expect(debts[1]).toMatchObject({ status: 'FORGIVEN', closeReason: 'STALE' });
      expect(debts[2]).toMatchObject({ status: 'PAID', closeReason: 'OFFSET', settledAt: settled.toISOString() });
    });

    it('nhóm có cả nợ OPEN và nợ đã đóng trong 30 ngày → một nhóm; nợ đã đóng vẫn hiện nhưng không tính vào openWeight', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const open = await oldDebt(h, 0, 1, 2, { createdAt: day(2) });
      const paid = await oldDebt(h, 0, 1, 3, { createdAt: day(9), status: 'PAID', closeReason: 'OFFSET', settledAt: day(5) });
      const forgiven = await oldDebt(h, 0, 1, 1, { createdAt: day(8), status: 'FORGIVEN', closeReason: 'FORGIVEN_BY_CREDITOR', settledAt: day(29) });
      const cancelled = await oldDebt(h, 0, 1, 1, { createdAt: day(7), status: 'CANCELLED', closeReason: 'COVER_MISSED', settledAt: day(1) });
      const res = await get(h, 0, 'mine').expect(200);
      expect(res.body.groups).toHaveLength(1);
      const g = res.body.groups[0];
      expect(g.openWeight).toBe(2);
      // Trong nhóm: OPEN trước, rồi theo createdAt tăng dần.
      expect(g.debts.map((d: any) => d.id)).toEqual([open.id, paid.id, forgiven.id, cancelled.id]);
      expect(g.debts.map((d: any) => d.status)).toEqual(['OPEN', 'PAID', 'FORGIVEN', 'CANCELLED']);
    });

    it('nợ đã đóng với settledAt cách đây 31 ngày (hoặc không có settledAt) không hiện; nhóm chỉ còn nợ đã cũ thì biến mất', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      await oldDebt(h, 0, 1, 2, { status: 'PAID', closeReason: 'OFFSET', settledAt: day(31) });
      await oldDebt(h, 2, 1, 2, { status: 'CANCELLED', closeReason: 'COVER_MISSED', settledAt: null });
      const keep = await oldDebt(h, 1, 0, 2, { status: 'PAID', closeReason: 'OFFSET', settledAt: day(29) });
      const res = await get(h, 0).expect(200);
      expect(res.body.groups).toHaveLength(1);
      expect(res.body.groups[0].debts.map((d: any) => d.id)).toEqual([keep.id]);
      expect(res.body.groups[0].openWeight).toBe(0);
    });

    it('scope=mine không lộ nhóm mà người xem không phải một trong hai bên; scope=all thấy cả nhà (mọi thành viên)', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      await oldDebt(h, 0, 1, 2); // Hùng nợ Thiện
      await oldDebt(h, 1, 2, 1); // Thiện nợ Mai
      const ids = (body: any) => body.groups.map((g: any) => `${g.debtorName}>${g.creditorName}`).sort();
      expect(ids((await get(h, 0, 'mine').expect(200)).body)).toEqual(['Hùng>Thiện']);
      expect(ids((await get(h, 1, 'mine').expect(200)).body)).toEqual(['Hùng>Thiện', 'Thiện>Mai']);
      expect(ids((await get(h, 2, 'mine').expect(200)).body)).toEqual(['Thiện>Mai']);
      for (const i of [0, 1, 2]) expect(ids((await get(h, i, 'all').expect(200)).body)).toEqual(['Hùng>Thiện', 'Thiện>Mai']);
      await get(h, 0, 'x').expect(400);
    });

    it('thứ tự: nhóm có nợ cũ nhất (createdAt nhỏ nhất) đứng trước; trong nhóm OPEN trước, rồi createdAt, rồi id', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      // Nhóm Y có khoản mới nhất nhưng cũng có khoản cổ nhất → đứng đầu. Nhóm X chỉ có khoản giữa.
      const x1 = await oldDebt(h, 0, 1, 1, { createdAt: day(5) });
      const y1 = await oldDebt(h, 2, 1, 1, { createdAt: day(10), status: 'PAID', closeReason: 'OFFSET', settledAt: day(1) });
      const y2 = await oldDebt(h, 2, 1, 1, { createdAt: day(1) });
      const y3 = await oldDebt(h, 2, 1, 1, { createdAt: day(3) });
      const res = await get(h, 0).expect(200);
      expect(res.body.groups.map((g: any) => g.debtorName)).toEqual(['Mai', 'Hùng']);
      expect(res.body.groups[0].debts.map((d: any) => d.id)).toEqual([y3.id, y2.id, y1.id]); // OPEN (cũ → mới) rồi nợ đã đóng
      expect(res.body.groups[1].debts.map((d: any) => d.id)).toEqual([x1.id]);
    });

    it('cùng createdAt thì xếp theo id', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const at = day(2);
      const a = await oldDebt(h, 0, 1, 1, { createdAt: at });
      const b = await oldDebt(h, 0, 1, 1, { createdAt: at });
      const res = await get(h, 0).expect(200);
      expect(res.body.groups[0].debts.map((d: any) => d.id)).toEqual([a.id, b.id].sort((p, q) => p.localeCompare(q)));
    });

    it('giới hạn 100 nhóm: trả đúng 100 nhóm cũ nhất, truncated = true, không nhóm nào bị cắt dở', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const creditor = member(h, 1);
      // 105 người nợ khác nhau (id giả, bảng nợ không có khóa ngoại) → 105 nhóm, mỗi nhóm 2 khoản.
      const data = Array.from({ length: 105 }, (_, i) => {
        const debtorMemberId = randomUUID();
        return [0, 1].map((j) => ({
          houseId: h.houseId,
          debtorMemberId,
          creditorMemberId: creditor,
          swapRequestId: randomUUID(),
          coverAssignmentId: randomUUID(),
          weight: 1 + j,
          createdAt: new Date(Date.now() - (200 - i) * 60_000 + j * 1000),
        }));
      }).flat();
      await fx.prisma.choreDebt.createMany({ data });

      const res = await get(h, 0).expect(200);
      expect(res.body.truncated).toBe(true);
      expect(res.body.groups).toHaveLength(100);
      expect(res.body.groups.every((g: any) => g.debts.length === 2 && g.openWeight === 3)).toBe(true);
      // 100 nhóm cũ nhất: người nợ thứ 0..99 theo thứ tự tạo.
      const firstDebtors = data.filter((_, i) => i % 2 === 0).slice(0, 100).map((d) => d.debtorMemberId);
      expect(res.body.groups.map((g: any) => g.debtorMemberId)).toEqual(firstDebtors);
    });

    it('đúng 100 nhóm thì không bị đánh dấu truncated', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      await fx.prisma.choreDebt.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          houseId: h.houseId,
          debtorMemberId: randomUUID(),
          creditorMemberId: member(h, 1),
          swapRequestId: randomUUID(),
          coverAssignmentId: randomUUID(),
          weight: 1,
          createdAt: new Date(Date.now() - (200 - i) * 60_000),
        })),
      });
      const res = await get(h, 0).expect(200);
      expect(res.body.groups).toHaveLength(100);
      expect(res.body.truncated).toBe(false);
    });

    it('nhà không có nợ → groups rỗng, không lỗi', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      expect((await get(h, 0).expect(200)).body).toEqual({ groups: [], truncated: false });
    });

    it('người ngoài nhà không đọc được', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const outsider = await fx.user('Người lạ');
      const res = await fx.as(outsider.token).get(`/api/v1/houses/${h.houseId}/chore-debts?scope=all`);
      expect([403, 404]).toContain(res.status);
    });
  });
});

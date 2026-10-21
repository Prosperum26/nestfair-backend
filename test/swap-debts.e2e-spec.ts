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
  const oldDebt = (h: House, debtor: number, creditor: number, weight: number, extra: object = {}) =>
    fx.prisma.choreDebt.create({
      data: {
        houseId: h.houseId,
        debtorMemberId: member(h, debtor),
        creditorMemberId: member(h, creditor),
        swapRequestId: randomUUID(),
        coverAssignmentId: randomUUID(),
        weight,
        ...extra,
      },
    });

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

  describe('GET /houses/:houseId/chore-debts', () => {
    it('scope=mine chỉ trả nợ mà người xem là debtor hoặc creditor; scope=all trả cả nhà (T-SW-20)', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const d = await oldDebt(h, 0, 1, 2); // Hùng nợ Thiện
      const get = (i: number, scope: string) => fx.as(h.users[i].token).get(`/api/v1/houses/${h.houseId}/chore-debts?scope=${scope}`);

      for (const i of [0, 1]) {
        const res = await get(i, 'mine').expect(200);
        expect(res.body.map((x: any) => x.id)).toEqual([d.id]);
      }
      expect((await get(2, 'mine').expect(200)).body).toEqual([]);
      const all = (await get(2, 'all').expect(200)).body;
      expect(all.map((x: any) => x.id)).toEqual([d.id]);
      expect(all[0]).toMatchObject({ debtorName: 'Hùng', creditorName: 'Thiện', weight: 2, status: 'OPEN' });
      await get(0, 'x').expect(400);
    });

    it('chỉ liệt kê nợ OPEN và kèm trạng thái hiển thị', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      await oldDebt(h, 0, 1, 2, { status: 'PAID', closeReason: 'OFFSET' });
      await oldDebt(h, 0, 1, 3);
      const res = await fx.as(h.users[0].token).get(`/api/v1/houses/${h.houseId}/chore-debts?scope=mine`).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ weight: 3, phase: 'WAITING_COVER' });
    });

    it('người ngoài nhà không đọc được', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const outsider = await fx.user('Người lạ');
      const res = await fx.as(outsider.token).get(`/api/v1/houses/${h.houseId}/chore-debts?scope=all`);
      expect([403, 404]).toContain(res.status);
    });
  });
});

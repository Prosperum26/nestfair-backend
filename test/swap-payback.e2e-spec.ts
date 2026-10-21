import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { addDays, dueAtOf, toDateStr, weekStartOf } from '../src/modules/chores/week.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { ChoreCronService } from '../src/modules/scheduler/chore-cron.service.js';
import { PaybackService } from '../src/modules/swaps/payback.service.js';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

describe('Chọn ca bù, tha nợ và auto-pick (e2e)', () => {
  let fx: Fx;
  let payback: PaybackService;
  let cron: ChoreCronService;
  let events: EventsService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swap-payback.nestfair.test');
    payback = fx.app.get(PaybackService);
    cron = fx.app.get(ChoreCronService);
    events = fx.app.get(EventsService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const hoursFromNow = (n: number) => new Date(Date.now() + n * HOUR);
  const DEBTOR = 1; // Thiện: được làm hộ, đang nợ ca
  const CREDITOR = 2; // Mai: đã làm hộ, được làm bù
  const member = (h: House, i: number) => h.memberId(h.users[i]);

  /** Thiện nhờ Mai làm hộ ca 3 điểm (PAYBACK), Mai làm xong, cửa sổ chọn bù đang mở (hạn chọn sau 47 giờ). */
  async function scenario(weight = 3) {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const cover = await makeAssignment(fx, h, { assignee: DEBTOR, dueAt: hoursFromNow(120) }, { weight });
    const created = await fx
      .as(h.users[DEBTOR].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'COVER', fromAssignmentId: cover.id, compensation: 'PAYBACK', targetMemberId: member(h, CREDITOR), acknowledgedWarnings: ['WEIGHT_GAP'] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await fx.as(h.users[CREDITOR].token).patch(`/api/v1/swaps/${created.body.id}/accept`).set('Idempotency-Key', randomUUID()).expect(200);
    await fx.prisma.choreAssignment.update({ where: { id: cover.id }, data: { status: 'DONE' } });
    const pickDeadlineAt = hoursFromNow(47);
    const debt = await fx.prisma.choreDebt.findFirstOrThrow({ where: { houseId: h.houseId } });
    await fx.prisma.choreDebt.update({ where: { id: debt.id }, data: { pickOpensAt: hoursFromNow(-1), pickDeadlineAt } });
    const nextWeek = addDays(toDateStr(cover.weekStart), 7);
    /** Ca của Mai ở tuần kế, mặc định hạn sau hạn chọn 24 giờ (hợp lệ). */
    const slot = (k: number, w: number, over: { dueAt?: Date; title?: string } = {}) =>
      makeAssignment(fx, h, { assignee: CREDITOR, occurrenceDate: addDays(nextWeek, k), dueAt: over.dueAt ?? new Date(pickDeadlineAt.getTime() + 24 * HOUR) }, { weight: w, title: over.title ?? `Ca ${k}-${w}` });
    return { h, cover, debtId: debt.id, pickDeadlineAt, nextWeek, slot };
  }
  const debtRow = (id: string) => fx.prisma.choreDebt.findUniqueOrThrow({ where: { id } });
  const pick = (h: House, user: number, debtId: string, assignmentId: string, key = randomUUID()) =>
    fx.as(h.users[user].token).patch(`/api/v1/chore-debts/${debtId}/payback`, { assignmentId }).set('Idempotency-Key', key);

  it('T-SW-03: chọn đúng ca 3 điểm → ca đổi sang người nợ (source PAYBACK); làm xong và được duyệt thì nợ PAID', async () => {
    const s = await scenario(3);
    const three = await s.slot(2, 3);
    await s.slot(1, 2);
    const send = vi.spyOn(events, 'send');

    const res = await pick(s.h, CREDITOR, s.debtId, three.id).expect(200);
    expect(res.body).toMatchObject({ alreadyDone: false });
    const slot = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: three.id } });
    expect(slot).toMatchObject({ assigneeId: member(s.h, DEBTOR), source: 'PAYBACK', originalAssigneeId: member(s.h, CREDITOR) });
    expect(slot.version).toBe(three.version + 1);
    expect((await debtRow(s.debtId)).paybackAssignmentId).toBe(three.id);
    expect(send.mock.calls.map((c) => (c[1] as { type: string }).type)).toContain('chore:reassigned');

    // Chọn lại cùng ca: replay; chọn ca khác: 409.
    expect((await pick(s.h, CREDITOR, s.debtId, three.id).expect(200)).body.alreadyDone).toBe(true);
    const other = await s.slot(3, 3);
    expect((await pick(s.h, CREDITOR, s.debtId, other.id).expect(409)).body.code).toBe('PAYBACK_ALREADY_CHOSEN');

    // Thiện làm ca bù, Hùng duyệt.
    await fx.prisma.choreAssignment.update({ where: { id: three.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
    await fx.as(s.h.users[0].token).patch(`/api/v1/assignments/${three.id}/verify`, { decision: 'APPROVED' }).expect(200);
    expect(await debtRow(s.debtId)).toMatchObject({ status: 'PAID' });
    expect((await debtRow(s.debtId)).settledAt).not.toBeNull();
  });

  it('B9: payback idempotent theo Idempotency-Key và theo ca đã chọn, kể cả khi nợ đã PAID', async () => {
    const s = await scenario(3);
    const chosen = await s.slot(2, 3);
    const other = await s.slot(3, 3);
    const key = randomUUID();
    expect((await pick(s.h, CREDITOR, s.debtId, chosen.id, key).expect(200)).body).toMatchObject({ alreadyDone: false, paybackAssignmentId: chosen.id });

    // Cùng key (kể cả body khác): trả lại kết quả cũ, không đổi gì.
    expect((await pick(s.h, CREDITOR, s.debtId, chosen.id, key).expect(200)).body).toMatchObject({ alreadyDone: true, paybackAssignmentId: chosen.id });
    expect((await pick(s.h, CREDITOR, s.debtId, other.id, key).expect(200)).body).toMatchObject({ alreadyDone: true, paybackAssignmentId: chosen.id });
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: other.id } })).assigneeId).toBe(member(s.h, CREDITOR));

    // Làm xong, nợ PAID.
    await fx.prisma.choreAssignment.update({ where: { id: chosen.id }, data: { status: 'PENDING_VERIFY', submittedAt: new Date() } });
    await fx.as(s.h.users[0].token).patch(`/api/v1/assignments/${chosen.id}/verify`, { decision: 'APPROVED' }).expect(200);
    expect((await debtRow(s.debtId)).status).toBe('PAID');

    // Sau khi PAID: cùng key hoặc cùng ca đã chọn vẫn là 200 với kết quả cũ; ca khác với key mới thì 409.
    expect((await pick(s.h, CREDITOR, s.debtId, chosen.id, key).expect(200)).body).toMatchObject({ alreadyDone: true, paybackAssignmentId: chosen.id });
    expect((await pick(s.h, CREDITOR, s.debtId, chosen.id).expect(200)).body).toMatchObject({ alreadyDone: true, paybackAssignmentId: chosen.id });
    expect((await pick(s.h, CREDITOR, s.debtId, other.id, key).expect(200)).body.paybackAssignmentId).toBe(chosen.id);
    expect((await pick(s.h, CREDITOR, s.debtId, other.id).expect(409)).body.code).toBe('DEBT_NOT_OPEN');
  });

  it('payback-options: ca hợp lệ kèm chênh độ nặng; ca quá gần hạn bị PAYBACK_TOO_SOON với câu tiếng Việt', async () => {
    const s = await scenario(3);
    const ok = await s.slot(2, 2);
    const soon = await s.slot(1, 1, { dueAt: new Date(s.pickDeadlineAt.getTime() + 5 * HOUR) });
    const res = await fx.as(s.h.users[CREDITOR].token).get(`/api/v1/chore-debts/${s.debtId}/payback-options`).expect(200);
    const byId = new Map<string, any>(res.body.options.map((o: any) => [o.assignmentId, o]));
    expect(byId.get(ok.id)).toMatchObject({ valid: true, weightDiff: -1 });
    expect(byId.get(soon.id)).toMatchObject({ valid: false, reasonCode: 'PAYBACK_TOO_SOON' });
    expect(byId.get(soon.id).reasonText).not.toMatch(/R-SWAP/);
    await fx.as(s.h.users[DEBTOR].token).get(`/api/v1/chore-debts/${s.debtId}/payback-options`).expect(403);
  });

  it('chọn ca không hợp lệ bị từ chối (422); debtor / người ngoài không phải creditor bị 403 NOT_CREDITOR', async () => {
    const s = await scenario(3);
    const soon = await s.slot(1, 3, { dueAt: new Date(s.pickDeadlineAt.getTime() + 2 * HOUR) });
    const ok = await s.slot(2, 3);
    expect((await pick(s.h, CREDITOR, s.debtId, soon.id).expect(422)).body.code).toBe('PAYBACK_TOO_SOON');
    expect((await pick(s.h, DEBTOR, s.debtId, ok.id).expect(403)).body.code).toBe('NOT_CREDITOR');
    expect((await pick(s.h, 0, s.debtId, ok.id).expect(403)).body.code).toBe('NOT_CREDITOR');
    expect((await debtRow(s.debtId)).paybackAssignmentId).toBeNull();
  });

  it('cửa sổ chưa mở (ca gốc chưa xong / chưa tới pickOpensAt) trả 409 PAYBACK_WINDOW_NOT_OPEN', async () => {
    const s = await scenario(3);
    const ok = await s.slot(2, 3);
    await fx.prisma.choreDebt.update({ where: { id: s.debtId }, data: { pickOpensAt: null, pickDeadlineAt: null } });
    expect((await pick(s.h, CREDITOR, s.debtId, ok.id).expect(409)).body.code).toBe('PAYBACK_WINDOW_NOT_OPEN');
  });

  it('T-SW-14: auto-pick sau hạn chọn lấy ca có độ nặng gần nhất và ghi AUTO_PICK; chạy lại không đổi', async () => {
    const s = await scenario(3);
    await s.slot(1, 2);
    const best = await s.slot(2, 3);
    await s.slot(3, 5);
    const after = new Date(s.pickDeadlineAt.getTime() + HOUR);

    expect(await payback.autoPick(after, [s.h.houseId])).toBe(1);
    expect((await debtRow(s.debtId)).paybackAssignmentId).toBe(best.id);
    expect(await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: best.id } })).toMatchObject({ assigneeId: member(s.h, DEBTOR), source: 'PAYBACK' });
    expect(await fx.prisma.choreAuditLog.count({ where: { houseId: s.h.houseId, action: 'AUTO_PICK' } })).toBe(1);
    expect(await payback.autoPick(after, [s.h.houseId])).toBe(0);
  });

  it('T-SW-14: chưa quá hạn chọn thì không auto-pick; không có ca hợp lệ thì dời pickOpensAt sang lần sinh lịch kế', async () => {
    const s = await scenario(3);
    expect(await payback.autoPick(hoursFromNow(1), [s.h.houseId])).toBe(0); // còn 46 giờ

    const after = new Date(s.pickDeadlineAt.getTime() + HOUR);
    expect(await payback.autoPick(after, [s.h.houseId])).toBe(0); // Mai chưa có ca nào hợp lệ
    const d = await debtRow(s.debtId);
    expect(d.paybackAssignmentId).toBeNull();
    expect(d.pickOpensAt!.getTime()).toBeGreaterThan(after.getTime());
    // Lần sinh lịch kế: Chủ Nhật 20:00 giờ nhà sau thời điểm auto-pick.
    const sunday = addDays(weekStartOf(after), 6);
    let expected = dueAtOf(sunday, '20:00');
    if (expected.getTime() <= after.getTime()) expected = dueAtOf(addDays(sunday, 7), '20:00');
    expect(d.pickOpensAt).toEqual(expected);
    expect(d.pickDeadlineAt!.getTime() - d.pickOpensAt!.getTime()).toBe(48 * HOUR);
  });

  it('T-SW-16: ca bù MISSED đưa nợ về OPEN (pickAttempts + 1); lần thứ ba chuyển cho Admin, không tự chọn nữa', async () => {
    const s = await scenario(3);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const chosen = await s.slot(attempt, 3, { dueAt: hoursFromNow(80) });
      await pick(s.h, CREDITOR, s.debtId, chosen.id).expect(200);
      // Ca bù quá hạn + ân hạn → MISSED.
      await fx.prisma.choreAssignment.update({ where: { id: chosen.id }, data: { dueAt: hoursFromNow(-5) } });
      expect(await cron.markMissed(new Date(), [s.h.houseId])).toBe(1);

      const d = await debtRow(s.debtId);
      expect(d).toMatchObject({ status: 'OPEN', pickAttempts: attempt, paybackAssignmentId: null });
      if (attempt < 3) {
        expect(d.pickOpensAt).not.toBeNull();
        expect(d.pickDeadlineAt!.getTime()).toBeGreaterThan(Date.now());
      } else {
        expect(d.pickOpensAt).toBeNull();
        expect(await fx.prisma.choreAuditLog.count({ where: { houseId: s.h.houseId, action: 'PAYBACK_NEEDS_ADMIN' } })).toBe(1);
      }
    }
    // Nợ đã giao cho Admin: auto-pick bỏ qua dù đã quá hạn.
    await s.slot(9, 3, { dueAt: hoursFromNow(200) });
    expect(await payback.autoPick(hoursFromNow(500), [s.h.houseId])).toBe(0);
    expect((await debtRow(s.debtId)).status).toBe('OPEN');
  });

  it('T-SW-32 (DB-21): Admin REASSIGN debtor vào ca cùng việc cùng ngày với ca bù đã chọn thì 422 DUPLICATE_CHORE_SAME_DAY', async () => {
    const s = await scenario(3);
    const chosen = await s.slot(2, 3);
    await pick(s.h, CREDITOR, s.debtId, chosen.id).expect(200);
    // Một ca khác của cùng việc, cùng ngày (slotIndex 1) đang là của Hùng.
    const twin = await fx.prisma.choreAssignment.create({
      data: {
        houseId: s.h.houseId,
        choreId: chosen.choreId,
        assigneeId: member(s.h, 0),
        originalAssigneeId: member(s.h, 0),
        weekKey: 'test',
        weekStart: chosen.weekStart,
        occurrenceDate: chosen.occurrenceDate,
        slotIndex: 1,
        dueAt: chosen.dueAt,
        titleSnapshot: chosen.titleSnapshot,
        weightSnapshot: chosen.weightSnapshot,
        source: 'ROTATION',
      },
    });
    const res = await fx
      .as(s.h.users[0].token)
      .patch(`/api/v1/assignments/${twin.id}/override`, { action: 'REASSIGN', reason: 'Giao lại cho Thiện', userId: s.h.users[DEBTOR].id })
      .expect(422);
    expect(res.body.code).toBe('DUPLICATE_CHORE_SAME_DAY');
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: twin.id } })).assigneeId).toBe(member(s.h, 0));
  });

  it('tha nợ khi ca bù còn TODO: ca trả lại creditor (source ROTATION); khi ca đã DONE thì 409', async () => {
    const a = await scenario(3);
    const chosen = await a.slot(2, 3);
    await pick(a.h, CREDITOR, a.debtId, chosen.id).expect(200);
    expect((await fx.as(a.h.users[DEBTOR].token).patch(`/api/v1/chore-debts/${a.debtId}/forgive`).expect(403)).body.code).toBe('NOT_CREDITOR');
    await fx.as(a.h.users[CREDITOR].token).patch(`/api/v1/chore-debts/${a.debtId}/forgive`).expect(200);
    expect(await debtRow(a.debtId)).toMatchObject({ status: 'FORGIVEN', closeReason: 'FORGIVEN_BY_CREDITOR' });
    expect(await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: chosen.id } })).toMatchObject({ assigneeId: member(a.h, CREDITOR), source: 'ROTATION' });

    const b = await scenario(3);
    const done = await b.slot(2, 3);
    await pick(b.h, CREDITOR, b.debtId, done.id).expect(200);
    await fx.prisma.choreAssignment.update({ where: { id: done.id }, data: { status: 'DONE' } });
    const res = await fx.as(b.h.users[CREDITOR].token).patch(`/api/v1/chore-debts/${b.debtId}/forgive`).expect(409);
    expect(res.body.code).toBe('DEBT_NOT_FORGIVABLE');
    expect((await debtRow(b.debtId)).status).toBe('OPEN');
  });

  it('tha nợ chưa chọn ca bù: nợ FORGIVEN, không động tới ca nào', async () => {
    const s = await scenario(3);
    await fx.as(s.h.users[CREDITOR].token).patch(`/api/v1/chore-debts/${s.debtId}/forgive`).expect(200);
    expect(await debtRow(s.debtId)).toMatchObject({ status: 'FORGIVEN', closeReason: 'FORGIVEN_BY_CREDITOR' });
    await fx.as(s.h.users[CREDITOR].token).patch(`/api/v1/chore-debts/${s.debtId}/forgive`).expect(409);
  });

  it('ca gốc được làm hộ bị MISSED trước khi xong: nợ bị hủy (COVER_MISSED)', async () => {
    const s = await scenario(3);
    await fx.prisma.choreAssignment.update({ where: { id: s.cover.id }, data: { status: 'TODO', dueAt: hoursFromNow(-5) } });
    expect(await cron.markMissed(new Date(), [s.h.houseId])).toBe(1);
    expect(await debtRow(s.debtId)).toMatchObject({ status: 'CANCELLED', closeReason: 'COVER_MISSED' });
  });

  it('IDOR: người ngoài nhà nhận 404 với debtId của nhà khác', async () => {
    const s = await scenario(3);
    const outsider = await fx.user('Người lạ');
    await fx.as(outsider.token).get(`/api/v1/chore-debts/${s.debtId}/payback-options`).expect(404);
    await fx.as(outsider.token).patch(`/api/v1/chore-debts/${s.debtId}/forgive`).expect(404);
  });
});

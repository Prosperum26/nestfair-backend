import { randomUUID } from 'node:crypto';
import { addDays, toDateStr } from '../src/modules/chores/week.js';
import { SwapCronService } from '../src/modules/scheduler/swap-cron.service.js';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

describe('Dọn dẹp đổi ca và nợ ca (e2e)', () => {
  let fx: Fx;
  let cron: SwapCronService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swap-maintenance.nestfair.test');
    cron = fx.app.get(SwapCronService);
  });
  afterAll(() => fx.cleanup());

  const inDays = (n: number) => new Date(Date.now() + n * 24 * HOUR);
  const member = (h: House, i: number) => h.memberId(h.users[i]);
  const debt = (h: House, over: object = {}) =>
    fx.prisma.choreDebt.create({
      data: {
        houseId: h.houseId,
        debtorMemberId: member(h, 0),
        creditorMemberId: member(h, 1),
        swapRequestId: randomUUID(),
        coverAssignmentId: randomUUID(),
        weight: 2,
        ...over,
      },
    });

  it('DB-22: người làm hộ khai vắng còn ≥ 24h trước ca cover, ca dời cho người khác thì nợ bị hủy (ABSENT_REASSIGN)', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const date = addDays(toDateStr(new Date()), 4);
    const slot = await makeAssignment(fx, h, { assignee: 0, occurrenceDate: date, dueAt: inDays(4) }, { weight: 2 });
    const created = await fx
      .as(h.users[0].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'COVER', fromAssignmentId: slot.id, compensation: 'PAYBACK', targetMemberId: member(h, 1), acknowledgedWarnings: [] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    await fx.as(h.users[1].token).patch(`/api/v1/swaps/${created.body.id}/accept`).set('Idempotency-Key', randomUUID()).expect(200);
    const open = await fx.prisma.choreDebt.findFirstOrThrow({ where: { houseId: h.houseId } });
    expect(open.status).toBe('OPEN');

    // Thiện (đang làm hộ) khai vắng đúng ngày ca: ca dời cho người khác.
    await fx.as(h.users[1].token).post(`/api/v1/houses/${h.houseId}/absences`, { startDate: date, endDate: date }).expect(201);
    const moved = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } });
    expect(moved.assigneeId).not.toBe(member(h, 1));
    const after = await fx.prisma.choreDebt.findUniqueOrThrow({ where: { id: open.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', closeReason: 'ABSENT_REASSIGN' });
    expect(after.settledAt).not.toBeNull();
  });

  it('khai vắng không đụng tới nợ của ca không bị dời', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện']);
    const d = await debt(h);
    const date = addDays(toDateStr(new Date()), 4);
    await fx.as(h.users[1].token).post(`/api/v1/houses/${h.houseId}/absences`, { startDate: date, endDate: date }).expect(201);
    expect((await fx.prisma.choreDebt.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('OPEN');
  });

  it('repairLocks xóa khóa mồ côi / của yêu cầu đã đóng, giữ khóa của yêu cầu còn PENDING; chạy lại không lỗi', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await makeAssignment(fx, h, { assignee: 0, dueAt: inDays(5) });
    const b = await makeAssignment(fx, h, { assignee: 1, dueAt: inDays(5) });

    const swapRes = await fx
      .as(h.users[0].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'EXCHANGE', fromAssignmentId: a.id, toAssignmentId: b.id, acknowledgedWarnings: [] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    // Tạo sau để không kích hoạt cảnh báo trần ca/ngày của yêu cầu ở trên.
    const orphan = await makeAssignment(fx, h, { assignee: 0, dueAt: inDays(5) });
    const closed = await makeAssignment(fx, h, { assignee: 0, dueAt: inDays(5) });
    await fx.prisma.swapLock.create({ data: { assignmentId: orphan.id, swapRequestId: randomUUID() } });
    // Yêu cầu đã EXPIRED nhưng khóa còn sót.
    const stale = await fx.prisma.choreSwapRequest.create({
      data: {
        houseId: h.houseId,
        type: 'COVER',
        requesterMemberId: member(h, 0),
        fromAssignmentId: closed.id,
        compensation: 'GIFT',
        status: 'EXPIRED',
        expiresAt: new Date(Date.now() - HOUR),
        rootRequestId: randomUUID(),
        fromWeightSnapshot: 2,
      },
    });
    await fx.prisma.swapLock.create({ data: { assignmentId: closed.id, swapRequestId: stale.id } });

    const removed = await cron.repairLocks();
    expect(removed).toBeGreaterThanOrEqual(2);
    const left = await fx.prisma.swapLock.findMany({ where: { assignmentId: { in: [a.id, b.id, orphan.id, closed.id] } } });
    expect(left.map((l) => l.assignmentId).sort()).toEqual([a.id, b.id].sort());
    expect(left.every((l) => l.swapRequestId === swapRes.body.id)).toBe(true);
    await expect(cron.repairLocks()).resolves.toBeGreaterThanOrEqual(0);
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(2);
  });

  it('settleStaleDebts: nợ OPEN quá 4 tuần chưa xếp được → FORGIVEN (STALE); nợ mới, nợ đã có ca bù, nợ giao Admin không đổi', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện']);
    const old = await debt(h, { createdAt: inDays(-29) });
    const young = await debt(h, { createdAt: inDays(-20) });
    const assigned = await debt(h, { createdAt: inDays(-40), paybackAssignmentId: randomUUID() });
    const needsAdmin = await debt(h, { createdAt: inDays(-40), pickAttempts: 3 });

    expect(await cron.settleStaleDebts(new Date(), [h.houseId])).toBe(1);
    const status = async (id: string) => fx.prisma.choreDebt.findUniqueOrThrow({ where: { id } });
    expect(await status(old.id)).toMatchObject({ status: 'FORGIVEN', closeReason: 'STALE' });
    expect((await status(old.id)).settledAt).not.toBeNull();
    for (const d of [young, assigned, needsAdmin]) expect((await status(d.id)).status).toBe('OPEN');
    expect(await cron.settleStaleDebts(new Date(), [h.houseId])).toBe(0);
  });

  it('settleStaleDebts không tha nợ vừa được chọn ca bù trong lúc cron đang chạy (B3)', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện']);
    const old = await debt(h, { createdAt: inDays(-29) });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const hasLock = new Promise<void>((r) => (locked = r));
    // Người được làm bù đang chọn ca (giữ khóa dòng nợ) khi cron đọc danh sách nợ cũ.
    const holder = fx.prisma.$transaction(
      async (tx) => {
        await tx.choreDebt.update({ where: { id: old.id }, data: { paybackAssignmentId: randomUUID() } });
        locked();
        await gate;
      },
      { timeout: 20_000 },
    );
    await hasLock;
    const running = cron.settleStaleDebts(new Date(), [h.houseId]);
    await new Promise((r) => setTimeout(r, 600));
    release();
    await holder;
    expect(await running).toBe(0);
    expect(await fx.prisma.choreDebt.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ status: 'OPEN', closeReason: null, settledAt: null });
  });
});

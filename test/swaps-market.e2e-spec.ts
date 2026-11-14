import { randomUUID } from 'node:crypto';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

describe('Chợ ca: nhận giúp đua nhau (e2e)', () => {
  let fx: Fx;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swaps-market.nestfair.test');
  });
  afterAll(() => fx.cleanup());

  const inDays = (n: number) => new Date(Date.now() + n * 24 * HOUR);

  /** Quân (user 0) đăng Chợ ca kèm quà cho một ca của mình. */
  async function market(names: string[], over: { compensation?: 'GIFT' | 'PAYBACK' } = {}) {
    const h = await fx.houseWith(names);
    const slot = await makeAssignment(fx, h, { assignee: 0, dueAt: inDays(5) }, { weight: 2 });
    const created = await fx
      .as(h.users[0].token)
      .post(`/api/v1/houses/${h.houseId}/swaps`, { type: 'COVER', fromAssignmentId: slot.id, compensation: over.compensation ?? 'GIFT', rewardAmount: over.compensation === 'PAYBACK' ? undefined : 30000, acknowledgedWarnings: [] })
      .set('Idempotency-Key', randomUUID())
      .expect(201);
    return { h, slot, swapId: created.body.id as string };
  }
  const accept = (h: House, user: number, swapId: string) =>
    fx.as(h.users[user].token).patch(`/api/v1/swaps/${swapId}/accept`).set('Idempotency-Key', randomUUID());
  const marketList = (h: House, user: number) => fx.as(h.users[user].token).get(`/api/v1/houses/${h.houseId}/swaps?scope=MARKET`);

  it('T-SW-06 / SW-24: 20 request nhận giúp song song, đúng một 200, 19 lần 409 SWAP_ALREADY_ACCEPTED, đúng một ca đổi người', async () => {
    const { h, slot, swapId } = await market(['Quân', 'Hùng', 'Mai', 'Thiện']);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => accept(h, 1 + (i % 3), swapId)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const losers = results.filter((r) => r.status === 409);
    expect(losers).toHaveLength(19);
    expect(losers.every((r) => r.body.code === 'SWAP_ALREADY_ACCEPTED' && r.body.message === 'Ca đã có người nhận.')).toBe(true);

    const swap0 = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: swapId } });
    const row = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } });
    expect(row.assigneeId).toBe(swap0.acceptedById);
    expect(row.assigneeId).not.toBe(h.memberId(h.users[0]));
    expect(row).toMatchObject({ source: 'COVER', version: slot.version + 1 });
    const swap = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: swapId } });
    expect(swap).toMatchObject({ status: 'ACCEPTED', acceptedById: row.assigneeId });
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: slot.id } })).toBe(0);
    // Đúng một mục ticker (một lần áp dụng).
    expect(await fx.prisma.houseActivity.count({ where: { houseId: h.houseId, type: 'swap.accepted' } })).toBe(1);
  }, 120_000);

  it('SW-30: người gửi tự nhận ca của mình nhận 403 CANNOT_ACCEPT_OWN', async () => {
    const { h, slot, swapId } = await market(['Quân', 'Hùng']);
    const res = await accept(h, 0, swapId).expect(403);
    expect(res.body.code).toBe('CANNOT_ACCEPT_OWN');
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } })).assigneeId).toBe(h.memberId(h.users[0]));
    expect((await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: swapId } })).status).toBe('PENDING');
  });

  it('SW-31: người vắng đúng ngày ca bị từ chối 422, yêu cầu vẫn PENDING cho người khác nhận', async () => {
    const { h, slot, swapId } = await market(['Quân', 'Hùng', 'Mai']);
    await fx.prisma.memberAbsence.create({
      data: {
        houseId: h.houseId,
        userId: h.users[1].id,
        startDate: slot.occurrenceDate,
        endDate: slot.occurrenceDate,
        createdById: h.users[0].id,
      },
    });
    const res = await accept(h, 1, swapId).expect(422);
    expect(res.body.code).toBe('TARGET_ABSENT');
    expect(await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: swapId } })).toMatchObject({ status: 'PENDING' });
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: slot.id } })).toBe(1);
    await accept(h, 2, swapId).expect(200);
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } })).assigneeId).toBe(h.memberId(h.users[2]));
  });

  it('SW-31: người đã có ca cùng việc cùng ngày không nhận được ca đó (eligibility trong danh sách)', async () => {
    const { h, slot, swapId } = await market(['Quân', 'Hùng', 'Mai']);
    // Hùng đã có một ca cùng việc, cùng ngày (slotIndex 1).
    await fx.prisma.choreAssignment.create({
      data: {
        houseId: h.houseId,
        choreId: slot.choreId,
        assigneeId: h.memberId(h.users[1]),
        originalAssigneeId: h.memberId(h.users[1]),
        weekKey: 'test',
        weekStart: slot.weekStart,
        occurrenceDate: slot.occurrenceDate,
        slotIndex: 1,
        dueAt: slot.dueAt,
        titleSnapshot: slot.titleSnapshot,
        weightSnapshot: slot.weightSnapshot,
        source: 'ROTATION',
      },
    });
    const hung = (await marketList(h, 1).expect(200)).body.find((s: any) => s.id === swapId);
    expect(hung.eligibility).toMatchObject({ canAccept: false, reasonCode: 'DUPLICATE_CHORE_SAME_DAY' });
    expect(hung.eligibility.reasonText).toBe(`Hùng đã có ca ${slot.titleSnapshot} hôm đó.`);
    const mai = (await marketList(h, 2).expect(200)).body.find((s: any) => s.id === swapId);
    expect(mai.eligibility).toEqual({ canAccept: true });

    const res = await accept(h, 1, swapId).expect(422);
    expect(res.body.code).toBe('DUPLICATE_CHORE_SAME_DAY');
    expect((await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: swapId } })).status).toBe('PENDING');
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } })).assigneeId).toBe(h.memberId(h.users[0]));
  });

  it('SW-32: sau khi có người nhận, ca biến khỏi GET scope=MARKET', async () => {
    const { h, swapId } = await market(['Quân', 'Hùng', 'Mai']);
    expect((await marketList(h, 2).expect(200)).body.map((s: any) => s.id)).toEqual([swapId]);
    await accept(h, 1, swapId).expect(200);
    expect((await marketList(h, 2).expect(200)).body).toEqual([]);
  });

  it('Chợ ca PAYBACK: người nhận giúp tạo nợ ca cho người đăng', async () => {
    const { h, swapId } = await market(['Quân', 'Hùng'], { compensation: 'PAYBACK' });
    await accept(h, 1, swapId).expect(200);
    const debt = await fx.prisma.choreDebt.findFirstOrThrow({ where: { houseId: h.houseId } });
    expect(debt).toMatchObject({ debtorMemberId: h.memberId(h.users[0]), creditorMemberId: h.memberId(h.users[1]), status: 'OPEN' });
  });

  it('Chợ ca hết hạn mà cron chưa chạy: accept trả 410 và yêu cầu ghi EXPIRED kèm escalationDeadline', async () => {
    const { h, slot, swapId } = await market(['Quân', 'Hùng']);
    await fx.prisma.choreSwapRequest.update({ where: { id: swapId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const res = await accept(h, 1, swapId).expect(410);
    expect(res.body.code).toBe('SWAP_EXPIRED');
    const row = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: swapId } });
    expect(row.status).toBe('EXPIRED');
    expect(row.escalationDeadline!.getTime()).toBe(slot.dueAt.getTime() - HOUR);
  });
});

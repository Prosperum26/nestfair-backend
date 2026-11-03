import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

describe('Nhờ trực dùm COVER (e2e)', () => {
  let fx: Fx;
  let events: EventsService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swaps-cover.nestfair.test');
    events = fx.app.get(EventsService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const inDays = (n: number) => new Date(Date.now() + n * 24 * HOUR);
  const slot = (house: House, assignee: number, over: { dueAt?: Date; weight?: number } = {}) =>
    makeAssignment(fx, house, { assignee, dueAt: over.dueAt ?? inDays(5) }, { weight: over.weight ?? 3 });
  const post = (house: House, user: number, body: object, key: string | null = randomUUID()) => {
    const req = fx.as(house.users[user].token).post(`/api/v1/houses/${house.houseId}/swaps`, { acknowledgedWarnings: [], ...body });
    return key ? req.set('Idempotency-Key', key) : req;
  };
  const cover = (from: { id: string }, extra: object = {}) => ({ type: 'COVER', fromAssignmentId: from.id, compensation: 'PAYBACK', ...extra });
  const accept = (house: House, user: number, swapId: string) =>
    fx.as(house.users[user].token).patch(`/api/v1/swaps/${swapId}/accept`).set('Idempotency-Key', randomUUID());
  const locks = (ids: string[]) => fx.prisma.swapLock.count({ where: { assignmentId: { in: ids } } });

  it('COVER + PAYBACK đích danh được chấp nhận: ca đổi sang người nhận (source COVER), có một ChoreDebt OPEN', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const a = await slot(house, 0, { weight: 3 });
    const target = house.memberId(house.users[1]);
    const created = await post(house, 0, cover(a, { targetMemberId: target })).expect(201);
    expect(created.body).toMatchObject({ type: 'COVER', status: 'PENDING', market: false, compensation: 'PAYBACK', targetMemberId: target });
    expect(await locks([a.id])).toBe(1);

    const send = vi.spyOn(events, 'send');
    const done = await accept(house, 1, created.body.id).expect(200);
    expect(done.body.swap).toMatchObject({ status: 'ACCEPTED', resolution: 'ACCEPTED_BY_TARGET' });

    const after = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(after).toMatchObject({ assigneeId: target, source: 'COVER', originalAssigneeId: house.memberId(house.users[0]), swapRequestId: created.body.id });
    expect(after.version).toBe(a.version + 1);

    const debts = await fx.prisma.choreDebt.findMany({ where: { houseId: house.houseId } });
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({
      status: 'OPEN',
      debtorMemberId: house.memberId(house.users[0]),
      creditorMemberId: target,
      coverAssignmentId: a.id,
      weight: 3,
      swapRequestId: created.body.id,
    });
    expect(await locks([a.id])).toBe(0);
    const types = send.mock.calls.map((c) => (c[1] as { type: string }).type);
    expect(types).toEqual(expect.arrayContaining(['swap:accepted', 'chore_debt:created']));
  });

  it('COVER + GIFT không tiền: không tạo ChoreDebt', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await slot(house, 0);
    const created = await post(house, 0, cover(a, { compensation: 'GIFT', rewardNote: 'Cảm ơn nhé', targetMemberId: house.memberId(house.users[1]) })).expect(201);
    expect(created.body).toMatchObject({ compensation: 'GIFT', rewardNote: 'Cảm ơn nhé', rewardAmount: null });
    await accept(house, 1, created.body.id).expect(200);
    expect(await fx.prisma.choreDebt.count({ where: { houseId: house.houseId } })).toBe(0);
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } })).source).toBe('COVER');
  });

  it('Chợ ca (không targetMemberId): market = true, thành viên khác nhận được', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const a = await slot(house, 0);
    const created = await post(house, 0, cover(a, { compensation: 'GIFT', rewardAmount: 30000, rewardNote: 'Bao trà sữa' })).expect(201);
    expect(created.body).toMatchObject({ market: true, targetMemberId: null, rewardAmount: 30000 });
    await accept(house, 2, created.body.id).expect(200);
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } })).assigneeId).toBe(house.memberId(house.users[2]));
  });

  it('R-SWAP-5: ca source = COVER không nhờ tiếp được (422 COVER_CHAIN_FORBIDDEN)', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await slot(house, 0);
    await fx.prisma.choreAssignment.update({ where: { id: a.id }, data: { source: 'COVER' } });
    const res = await post(house, 0, cover(a, { targetMemberId: house.memberId(house.users[1]) })).expect(422);
    expect(res.body).toMatchObject({ code: 'COVER_CHAIN_FORBIDDEN', message: 'Ca này bạn đang làm hộ, không nhờ tiếp được.' });
  });

  it('R-SWAP-8: ca PAYBACK không thể COVER (422 PAYBACK_SLOT_LOCKED)', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await slot(house, 0);
    await fx.prisma.choreAssignment.update({ where: { id: a.id }, data: { source: 'PAYBACK' } });
    const res = await post(house, 0, cover(a)).expect(422);
    expect(res.body.code).toBe('PAYBACK_SLOT_LOCKED');
  });

  it.each([[999], [500001], [1500]])('R-SWAP-14: rewardAmount = %i trả 422 REWARD_OUT_OF_RANGE', async (amount) => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await slot(house, 0);
    const res = await post(house, 0, cover(a, { compensation: 'GIFT', rewardAmount: amount })).expect(422);
    expect(res.body.code).toBe('REWARD_OUT_OF_RANGE');
    expect(await locks([a.id])).toBe(0);
  });

  it('R-SWAP-14: rewardAmount đi kèm PAYBACK trả 422', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await slot(house, 0);
    const res = await post(house, 0, cover(a, { rewardAmount: 30000 })).expect(422);
    expect(res.body.code).toBe('REWARD_OUT_OF_RANGE');
  });

  it('D4: ca WHEEL — COVER PAYBACK 422, COVER GIFT không tiền được, EXCHANGE 422 WHEEL_NOT_EXCHANGEABLE', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const wheel = await slot(house, 0);
    await fx.prisma.choreAssignment.update({ where: { id: wheel.id }, data: { source: 'WHEEL' } });
    const target = house.memberId(house.users[1]);

    const payback = await post(house, 0, cover(wheel, { targetMemberId: target })).expect(422);
    expect(payback.body.code).toBe('WHEEL_NOT_EXCHANGEABLE');
    await post(house, 0, cover(wheel, { compensation: 'GIFT', targetMemberId: target })).expect(201);

    const w2 = await slot(house, 0);
    await fx.prisma.choreAssignment.update({ where: { id: w2.id }, data: { source: 'WHEEL' } });
    const other = await slot(house, 1);
    const ex = await post(house, 0, { type: 'EXCHANGE', fromAssignmentId: w2.id, toAssignmentId: other.id }).expect(422);
    expect(ex.body.code).toBe('WHEEL_NOT_EXCHANGEABLE');
    const ex2 = await post(house, 1, { type: 'EXCHANGE', fromAssignmentId: other.id, toAssignmentId: w2.id }).expect(422);
    expect(ex2.body.code).toBe('WHEEL_NOT_EXCHANGEABLE');
  });

  it('URGENT: còn dưới 6 giờ thì đích danh 422 URGENT_MARKET_ONLY; Chợ ca được, expiresAt = dueAt − 1h', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const dueAt = new Date(Date.now() + 4 * HOUR);
    const a = await slot(house, 0, { dueAt });
    const res = await post(house, 0, cover(a, { targetMemberId: house.memberId(house.users[1]) })).expect(422);
    expect(res.body.code).toBe('URGENT_MARKET_ONLY');

    const market = await post(house, 0, cover(a, { compensation: 'GIFT', acknowledgedWarnings: ['DUE_SOON'] })).expect(201);
    expect(new Date(market.body.expiresAt).getTime()).toBe(dueAt.getTime() - HOUR);
  });

  it('expiresAt của COVER còn nhiều thời gian = min(createdAt + 24h, dueAt − 6h)', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const far = await slot(house, 0, { dueAt: inDays(5) });
    const before = Date.now();
    const res = await post(house, 0, cover(far, { targetMemberId: house.memberId(house.users[1]) })).expect(201);
    const exp = new Date(res.body.expiresAt).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 24 * HOUR);
    expect(exp).toBeLessThanOrEqual(Date.now() + 24 * HOUR);

    const near = await slot(house, 0, { dueAt: new Date(Date.now() + 10 * HOUR) });
    const res2 = await post(house, 0, cover(near, { targetMemberId: house.memberId(house.users[1]) })).expect(201);
    expect(new Date(res2.body.expiresAt).getTime()).toBe(near.dueAt.getTime() - 6 * HOUR);
  });

  it('DTO: COVER thiếu compensation 400; gửi cho chính mình 422 SWAP_SELF; người nhận khác nhà 422', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await slot(house, 0);
    await post(house, 0, { type: 'COVER', fromAssignmentId: a.id }).expect(400);
    const self = await post(house, 0, cover(a, { targetMemberId: house.memberId(house.users[0]) })).expect(422);
    expect(self.body.code).toBe('SWAP_SELF');
    const stranger = await fx.houseWith(['Quân', 'Lan']);
    const foreign = await post(house, 0, cover(a, { targetMemberId: stranger.memberId(stranger.users[0]) })).expect(422);
    expect(foreign.body.code).toBe('TARGET_LEFT');
  });

  it('người nhận đích danh sai gọi accept bị 403; accept lại ở ca đã bị người khác đổi: 409 SLOT_CHANGED', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const a = await slot(house, 0);
    const created = await post(house, 0, cover(a, { targetMemberId: house.memberId(house.users[1]) })).expect(201);
    expect((await accept(house, 2, created.body.id).expect(403)).body.code).toBe('NOT_SWAP_TARGET');

    await fx.prisma.choreAssignment.update({ where: { id: a.id }, data: { assigneeId: house.memberId(house.users[2]) } });
    const res = await accept(house, 1, created.body.id).expect(409);
    expect(res.body.code).toBe('SLOT_CHANGED');
    expect(await locks([a.id])).toBe(0);
  });
});

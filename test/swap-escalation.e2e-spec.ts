import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import { SwapEscalationService } from '../src/modules/swaps/swap-escalation.service.js';
import { SwapsService } from '../src/modules/swaps/swaps.service.js';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

describe('Hết hạn và leo thang (e2e)', () => {
  let fx: Fx;
  let swaps: SwapsService;
  let esc: SwapEscalationService;
  let events: EventsService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swap-escalation.nestfair.test');
    swaps = fx.app.get(SwapsService);
    esc = fx.app.get(SwapEscalationService);
    events = fx.app.get(EventsService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const at = (hours: number) => new Date(Date.now() + hours * HOUR);
  const member = (h: House, i: number) => ({
    id: h.memberId(h.users[i]),
    houseId: h.houseId,
    userId: h.users[i].id,
    role: i === 0 ? ('ADMIN' as const) : ('ROOMMATE' as const),
  });
  const mid = (h: House, i: number) => h.memberId(h.users[i]);

  /** Quân (user 0) đăng Chợ ca kèm quà 30.000đ cho ca hạn sau 5 ngày (tạo "lúc" `createdAt`). */
  async function market(names = ['Quân', 'Hùng', 'Mai'], over: { target?: number; dueHours?: number } = {}) {
    const h = await fx.houseWith(names);
    const slot = await makeAssignment(fx, h, { assignee: 0, dueAt: at(over.dueHours ?? 120) }, { weight: 2 });
    const { swap } = await swaps.create(
      member(h, 0),
      {
        type: 'COVER',
        fromAssignmentId: slot.id,
        compensation: 'GIFT',
        rewardAmount: 30000,
        rewardNote: 'Bao trà sữa',
        targetMemberId: over.target === undefined ? undefined : mid(h, over.target),
        acknowledgedWarnings: [],
      },
      randomUUID(),
    );
    return { h, slot, swapId: swap.id };
  }
  const row = (id: string) => fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id } });
  const locks = (ids: string[]) => fx.prisma.swapLock.count({ where: { assignmentId: { in: ids } } });
  const expire = (h: House, now: Date) => esc.expireDue(now, [h.houseId]);
  const escalate = (h: House, user: number, swapId: string, dto: object, now: Date, key = randomUUID()) =>
    esc.escalate(member(h, user), swapId, dto as never, key, now);
  const failure = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as HttpException;
  const codeOf = (e: HttpException | null) => (e?.getResponse() as { code?: string } | undefined)?.code;

  it('T-SW-05: hết hạn → thêm quà đăng lại → hết hạn lần hai → không chọn gì thì SELF_DEFAULT, ca vẫn của người gửi, cùng rootRequestId', async () => {
    const { h, slot, swapId } = await market();
    const send = vi.spyOn(events, 'send');

    expect(await expire(h, at(25))).toBe(1);
    const first = await row(swapId);
    expect(first).toMatchObject({ status: 'EXPIRED', resolution: 'EXPIRED_NO_TAKER', escalationChoice: null });
    expect(first.escalationDeadline).toEqual(new Date(slot.dueAt.getTime() - HOUR));
    expect(await locks([slot.id])).toBe(0);
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } })).assigneeId).toBe(mid(h, 0));
    expect(send.mock.calls.filter((c) => (c[1] as { type: string }).type === 'swap:expired').map((c) => c[0])).toEqual([`user:${h.users[0].id}`]);

    const res = await escalate(h, 0, swapId, { action: 'ADD_REWARD', rewardAmount: 50000 }, at(25));
    expect(res.newSwap).toMatchObject({ status: 'PENDING', type: 'COVER', market: true, compensation: 'GIFT', rewardAmount: 50000, rootRequestId: swapId });
    expect(await row(swapId)).toMatchObject({ resolution: 'ESCALATED', escalationChoice: 'ADD_REWARD', status: 'EXPIRED' });
    expect(await locks([slot.id])).toBe(1);
    expect(send.mock.calls.map((c) => (c[1] as { type: string }).type)).toContain('swap:escalated');

    expect(await expire(h, at(50))).toBe(1);
    const second = await row(res.newSwap!.id);
    expect(second.status).toBe('EXPIRED');
    // Quá escalationDeadline mà không chọn → SELF_DEFAULT.
    await expire(h, new Date(slot.dueAt.getTime() - HOUR + 60_000));
    expect(await row(res.newSwap!.id)).toMatchObject({ escalationChoice: 'SELF_DEFAULT', rootRequestId: swapId });
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: slot.id } })).assigneeId).toBe(mid(h, 0));
  });

  it('ES-02 / ES-15: ADD_REWARD không tăng quà (và không có lời nhắn mới) trả 422 REWARD_NOT_INCREASED', async () => {
    const { h, swapId } = await market();
    await expire(h, at(25));
    for (const dto of [{ action: 'ADD_REWARD', rewardAmount: 30000 }, { action: 'ADD_REWARD', rewardAmount: 20000 }, { action: 'ADD_REWARD' }]) {
      expect(codeOf(await failure(escalate(h, 0, swapId, { ...dto, rewardNote: 'Bao trà sữa' }, at(25))))).toBe('REWARD_NOT_INCREASED');
    }
    expect((await row(swapId)).escalationChoice).toBeNull();
    // Lời nhắn mới thì được dù số tiền không đổi.
    const ok = await escalate(h, 0, swapId, { action: 'ADD_REWARD', rewardAmount: 30000, rewardNote: 'Bao thêm bánh' }, at(25));
    expect(ok.newSwap).toMatchObject({ rewardAmount: 30000, rewardNote: 'Bao thêm bánh' });
  });

  it('ADD_REWARD với số tiền ngoài khoảng trả 422 REWARD_OUT_OF_RANGE', async () => {
    const { h, swapId } = await market();
    await expire(h, at(25));
    expect(codeOf(await failure(escalate(h, 0, swapId, { action: 'ADD_REWARD', rewardAmount: 600000 }, at(25))))).toBe('REWARD_OUT_OF_RANGE');
    expect(codeOf(await failure(escalate(h, 0, swapId, { action: 'ADD_REWARD', rewardAmount: 31500 }, at(25))))).toBe('REWARD_OUT_OF_RANGE');
  });

  it('ES-05: còn dưới 15 phút trước dueAt − 1h thì ADD_REWARD / RESEND 422 ESCALATE_TOO_LATE, SELF vẫn được', async () => {
    const { h, slot, swapId } = await market();
    await expire(h, at(25));
    const late = new Date(slot.dueAt.getTime() - HOUR - 10 * 60_000);
    expect(codeOf(await failure(escalate(h, 0, swapId, { action: 'ADD_REWARD', rewardAmount: 50000 }, late)))).toBe('ESCALATE_TOO_LATE');
    expect(codeOf(await failure(escalate(h, 0, swapId, { action: 'RESEND' }, late)))).toBe('ESCALATE_TOO_LATE');
    const self = await escalate(h, 0, swapId, { action: 'SELF' }, late);
    expect(self.newSwap).toBeUndefined();
    expect(await row(swapId)).toMatchObject({ escalationChoice: 'SELF', resolution: 'EXPIRED_NO_TAKER' });
  });

  it('ES-06: quá 2 lần ADD_REWARD hoặc chuỗi quá 4 yêu cầu trả 422 ESCALATE_LIMIT', async () => {
    const { h, swapId } = await market(['Quân', 'Hùng', 'Mai', 'Thiện']);
    await expire(h, at(25));
    const a = await escalate(h, 0, swapId, { action: 'ADD_REWARD', rewardAmount: 40000 }, at(25));
    await expire(h, at(50));
    const b = await escalate(h, 0, a.newSwap!.id, { action: 'ADD_REWARD', rewardAmount: 50000 }, at(50));
    await expire(h, at(75));
    expect(codeOf(await failure(escalate(h, 0, b.newSwap!.id, { action: 'ADD_REWARD', rewardAmount: 60000 }, at(75))))).toBe('ESCALATE_LIMIT');

    // RESEND vẫn được: yêu cầu thứ 4 của chuỗi. Sau đó chuỗi đã đủ 4 nên RESEND tiếp bị chặn.
    const resend = await escalate(h, 0, b.newSwap!.id, { action: 'RESEND' }, at(75));
    expect(resend.newSwap).toMatchObject({ market: false, rootRequestId: swapId });
    await expire(h, at(100));
    expect(codeOf(await failure(escalate(h, 0, resend.newSwap!.id, { action: 'RESEND' }, at(100))))).toBe('ESCALATE_LIMIT');
  });

  it('RESEND: gửi đích danh cho người chưa từng được gửi trong chuỗi; hết người thì 422 NO_RESEND_CANDIDATE (ES-14)', async () => {
    const { h, swapId } = await market(['Quân', 'Hùng', 'Mai'], { target: 1 });
    await expire(h, at(25));
    const res = await escalate(h, 0, swapId, { action: 'RESEND' }, at(25));
    expect(res.newSwap).toMatchObject({ market: false, targetMemberId: mid(h, 2), rootRequestId: swapId });
    expect(await row(swapId)).toMatchObject({ escalationChoice: 'RESEND', resolution: 'ESCALATED' });

    await expire(h, at(50));
    expect(codeOf(await failure(escalate(h, 0, res.newSwap!.id, { action: 'RESEND' }, at(50))))).toBe('NO_RESEND_CANDIDATE');
    expect((await row(res.newSwap!.id)).escalationChoice).toBeNull();
  });

  it('ES-08: người không phải người gửi leo thang bị 403 NOT_REQUESTER; yêu cầu chưa hết hạn bị 409', async () => {
    const { h, swapId } = await market();
    expect(codeOf(await failure(escalate(h, 0, swapId, { action: 'SELF' }, at(1))))).toBe('SWAP_NOT_PENDING'); // còn PENDING
    await expire(h, at(25));
    expect(codeOf(await failure(escalate(h, 1, swapId, { action: 'SELF' }, at(25))))).toBe('NOT_REQUESTER');
  });

  it('T-SW-34: hai escalate đồng thời trên một yêu cầu EXPIRED: một thành công, một lỗi, chuỗi chỉ có một PENDING', async () => {
    const { h, swapId } = await market();
    await expire(h, at(25));
    const results = await Promise.allSettled([
      escalate(h, 0, swapId, { action: 'ADD_REWARD', rewardAmount: 50000 }, at(25)),
      escalate(h, 0, swapId, { action: 'ADD_REWARD', rewardAmount: 60000 }, at(25)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(codeOf((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason as HttpException)).toBe('SWAP_NOT_PENDING');
    expect(await fx.prisma.choreSwapRequest.count({ where: { rootRequestId: swapId, status: 'PENDING' } })).toBe(1);
    expect(await fx.prisma.choreSwapRequest.count({ where: { rootRequestId: swapId } })).toBe(2);
  });

  it('cùng Idempotency-Key gửi lại escalate thì trả kết quả cũ, không tạo thêm yêu cầu', async () => {
    const { h, swapId } = await market();
    await expire(h, at(25));
    const key = randomUUID();
    const first = await escalate(h, 0, swapId, { action: 'ADD_REWARD', rewardAmount: 50000 }, at(25), key);
    const again = await escalate(h, 0, swapId, { action: 'ADD_REWARD', rewardAmount: 50000 }, at(25), key);
    expect(again.newSwap!.id).toBe(first.newSwap!.id);
    expect(await fx.prisma.choreSwapRequest.count({ where: { rootRequestId: swapId } })).toBe(2);
  });

  it('T-SW-19: expireDue chạy hai lần hoặc song song không đổi hai lần và chỉ phát một swap:expired', async () => {
    const { h, swapId } = await market();
    const send = vi.spyOn(events, 'send');
    const counts = await Promise.all([expire(h, at(25)), expire(h, at(25)), expire(h, at(25))]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await expire(h, at(26))).toBe(0);
    expect((await row(swapId)).status).toBe('EXPIRED');
    expect(send.mock.calls.filter((c) => (c[1] as { type: string }).type === 'swap:expired')).toHaveLength(1);
  });

  it('yêu cầu EXCHANGE hết hạn: EXPIRED, không có hạn leo thang, không leo thang được', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await makeAssignment(fx, h, { assignee: 0, dueAt: at(120) });
    const b = await makeAssignment(fx, h, { assignee: 1, dueAt: at(121) });
    const { swap } = await swaps.create(member(h, 0), { type: 'EXCHANGE', fromAssignmentId: a.id, toAssignmentId: b.id, acknowledgedWarnings: [] }, randomUUID());
    await expire(h, at(25));
    expect(await row(swap.id)).toMatchObject({ status: 'EXPIRED', escalationDeadline: null });
    expect(await locks([a.id, b.id])).toBe(0);
    expect(codeOf(await failure(escalate(h, 0, swap.id, { action: 'RESEND' }, at(25))))).toBe('SWAP_NOT_PENDING');
  });

  it('HTTP: POST /swaps/:id/escalate cần Idempotency-Key; SELF trả 200', async () => {
    const { h, swapId } = await market();
    await expire(h, at(25));
    const noKey = await fx.as(h.users[0].token).post(`/api/v1/swaps/${swapId}/escalate`, { action: 'SELF' }).expect(400);
    expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const res = await fx.as(h.users[0].token).post(`/api/v1/swaps/${swapId}/escalate`, { action: 'SELF' }).set('Idempotency-Key', randomUUID()).expect(200);
    expect(res.body.swap).toMatchObject({ id: swapId, status: 'EXPIRED' });
    await fx.as(h.users[0].token).post(`/api/v1/swaps/${swapId}/escalate`, { action: 'BAD' }).set('Idempotency-Key', randomUUID()).expect(400);
  });
});

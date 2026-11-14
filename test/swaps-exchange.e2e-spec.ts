import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { vi } from 'vitest';
import { ActivityService } from '../src/modules/activity/activity.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { addDays, dueAtOf, weekStartOf } from '../src/modules/chores/week.js';
import { SwapsService } from '../src/modules/swaps/swaps.service.js';
import { makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

const ALL_WARNINGS = ['WEIGHT_GAP', 'FENCE_REPEAT', 'OVER_DAILY_CAP', 'CONSECUTIVE_DAY', 'DUE_SOON'];

describe('Đổi ca EXCHANGE (e2e)', () => {
  let fx: Fx;
  let swaps: SwapsService;
  let events: EventsService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swaps-exchange.nestfair.test');
    swaps = fx.app.get(SwapsService);
    events = fx.app.get(EventsService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  // Cả tuần kế tiếp nằm hẳn trong tương lai nên ca không quá hạn khi test chạy.
  const monday = addDays(weekStartOf(new Date()), 7);
  const day = (n: number) => addDays(monday, n);
  const slot = (house: House, assignee: number, date: string, weight = 2) =>
    makeAssignment(fx, house, { assignee, occurrenceDate: date, dueAt: dueAtOf(date, '21:00') }, { weight, title: `Việc ${assignee}-${date}-${weight}` });

  const create = (token: string, houseId: string, body: object, key: string | null = randomUUID()) => {
    const req = fx.as(token).post(`/api/v1/houses/${houseId}/swaps`, body);
    return key ? req.set('Idempotency-Key', key) : req;
  };
  const exchange = (from: { id: string }, to: { id: string }, extra: object = {}) => ({
    type: 'EXCHANGE',
    fromAssignmentId: from.id,
    toAssignmentId: to.id,
    acknowledgedWarnings: [],
    ...extra,
  });
  const act = (token: string, swapId: string, verb: 'accept' | 'reject' | 'cancel', key: string | null = randomUUID(), body?: object) => {
    const req = fx.as(token).patch(`/api/v1/swaps/${swapId}/${verb}`, body);
    return key ? req.set('Idempotency-Key', key) : req;
  };
  const membership = (house: House, i: number) => ({
    id: house.memberId(house.users[i]),
    houseId: house.houseId,
    userId: house.users[i].id,
    role: i === 0 ? ('ADMIN' as const) : ('ROOMMATE' as const),
  });

  async function pair(weights: [number, number] = [2, 2]) {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const a = await slot(house, 0, day(1), weights[0]);
    const b = await slot(house, 1, day(3), weights[1]);
    return { house, a, b };
  }

  it('T-SW-01: tạo rồi chấp nhận thì hai ca đổi người, source = SWAP, originalAssignee giữ nguyên, version tăng', async () => {
    const { house, a, b } = await pair();
    const created = await create(house.users[0].token, house.houseId, exchange(a, b, { reason: 'Mình bận học', note: 'Cảm ơn nhé' })).expect(201);
    expect(created.body).toMatchObject({ type: 'EXCHANGE', status: 'PENDING', market: false });
    expect(created.body.rootRequestId).toBe(created.body.id);
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(2);

    const sendSpy = vi.spyOn(events, 'send');
    const accepted = await act(house.users[1].token, created.body.id, 'accept').expect(200);
    expect(accepted.body).toMatchObject({ alreadyDone: false, swap: { status: 'ACCEPTED', resolution: 'ACCEPTED_BY_TARGET' } });

    const [na, nb] = await Promise.all([
      fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } }),
      fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: b.id } }),
    ]);
    expect(na.assigneeId).toBe(house.memberId(house.users[1]));
    expect(nb.assigneeId).toBe(house.memberId(house.users[0]));
    expect([na.source, nb.source]).toEqual(['SWAP', 'SWAP']);
    expect(na.originalAssigneeId).toBe(house.memberId(house.users[0]));
    expect(nb.originalAssigneeId).toBe(house.memberId(house.users[1]));
    expect([na.version, nb.version]).toEqual([a.version + 1, b.version + 1]);
    expect(na.swapRequestId).toBe(created.body.id);
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(0);

    const types = sendSpy.mock.calls.map((c) => (c[1] as { type: string }).type);
    expect(types).toContain('swap:accepted');
    const accEvent = sendSpy.mock.calls.map((c) => c[1] as { type: string; payload: Record<string, unknown> }).find((e) => e.type === 'swap:accepted')!;
    expect(JSON.stringify(accEvent.payload)).not.toMatch(/Mình bận học|Cảm ơn nhé/);

    const activity = await fx.prisma.houseActivity.findFirstOrThrow({ where: { houseId: house.houseId, type: 'swap.accepted' } });
    expect(JSON.stringify(activity.params)).not.toMatch(/Mình bận học|Cảm ơn nhé/);
  });

  it('SW-07 / T-SW-26: đổi chéo gửi cùng lúc thì đúng một yêu cầu được tạo, một nhận 409 SLOT_LOCKED', async () => {
    const { house, a, b } = await pair();
    const results = await Promise.all([
      create(house.users[0].token, house.houseId, exchange(a, b)),
      create(house.users[1].token, house.houseId, exchange(b, a)),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('SLOT_LOCKED');
  });

  it('T-SW-07: 20 yêu cầu song song trên cùng một ca thì đúng một thành công', async () => {
    const { house, a, b } = await pair();
    const results = await Promise.all(Array.from({ length: 20 }, () => create(house.users[0].token, house.houseId, exchange(a, b))));
    const codes = results.map((r) => r.status);
    expect(codes.filter((s) => s === 201)).toHaveLength(1);
    expect(codes.filter((s) => s === 409)).toHaveLength(19);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'SLOT_LOCKED')).toBe(true);
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(2);
  }, 120_000);

  it('T-SW-25: accept đúng lúc hết hạn (cron chưa chạy) trả 410 và EXPIRED còn nguyên sau khi trả lỗi', async () => {
    const { house, a, b } = await pair();
    const past = new Date(Date.now() - 2 * 24 * 3_600_000);
    const { swap } = await swaps.create(membership(house, 0), exchange(a, b) as never, randomUUID(), past);
    expect(new Date(swap.expiresAt).getTime()).toBeLessThan(Date.now());

    const res = await act(house.users[1].token, swap.id, 'accept').expect(410);
    expect(res.body).toMatchObject({ code: 'SWAP_EXPIRED', message: 'Yêu cầu đã hết hạn.' });
    const row = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: swap.id } });
    expect(row).toMatchObject({ status: 'EXPIRED', resolution: 'EXPIRED_NO_TAKER' });
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(0);
    const unchanged = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(unchanged.assigneeId).toBe(house.memberId(house.users[0]));
  });

  it('T-SW-33: accept lặp với cùng Idempotency-Key trả alreadyDone và không đổi dữ liệu lần hai', async () => {
    const { house, a, b } = await pair();
    const created = await create(house.users[0].token, house.houseId, exchange(a, b)).expect(201);
    const key = randomUUID();
    const first = await act(house.users[1].token, created.body.id, 'accept', key).expect(200);
    expect(first.body.alreadyDone).toBe(false);
    const afterFirst = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } });

    const second = await act(house.users[1].token, created.body.id, 'accept', key).expect(200);
    expect(second.body).toMatchObject({ alreadyDone: true, swap: { status: 'ACCEPTED' } });
    const afterSecond = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(afterSecond.version).toBe(afterFirst.version);
    expect(afterSecond.assigneeId).toBe(afterFirst.assigneeId);

    // Key khác thì không phải replay: yêu cầu đã ACCEPTED.
    const other = await act(house.users[1].token, created.body.id, 'accept').expect(409);
    expect(other.body.code).toBe('SWAP_NOT_PENDING');
  });

  it('create: thiếu Idempotency-Key trả 400; cùng key gửi lại trả lại yêu cầu cũ (200), không tạo hai dòng', async () => {
    const { house, a, b } = await pair();
    const noKey = await create(house.users[0].token, house.houseId, exchange(a, b), null).expect(400);
    expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const key = randomUUID();
    const first = await create(house.users[0].token, house.houseId, exchange(a, b), key).expect(201);
    const again = await create(house.users[0].token, house.houseId, exchange(a, b), key).expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await fx.prisma.choreSwapRequest.count({ where: { houseId: house.houseId } })).toBe(1);
  });

  it('chưa tick cảnh báo WEIGHT_GAP thì 422 WARNINGS_NOT_ACKNOWLEDGED; tick đủ thì tạo được', async () => {
    const { house, a, b } = await pair([4, 1]);
    const res = await create(house.users[0].token, house.houseId, exchange(a, b)).expect(422);
    expect(res.body).toMatchObject({ code: 'WARNINGS_NOT_ACKNOWLEDGED', warnings: ['WEIGHT_GAP'] });
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(0);
    await create(house.users[0].token, house.houseId, exchange(a, b, { acknowledgedWarnings: ['WEIGHT_GAP'] })).expect(201);
  });

  it('vi phạm quy tắc cứng khi tạo trả mã chuẩn (khác tuần: 422 WEEK_MISMATCH)', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await slot(house, 0, day(1));
    const far = await slot(house, 1, day(9));
    const res = await create(house.users[0].token, house.houseId, exchange(a, far)).expect(422);
    expect(res.body.code).toBe('WEEK_MISMATCH');
  });

  it('chỉ chủ ca mới tạo được; ca của nhà khác bị 404 (IDOR)', async () => {
    const { house, a, b } = await pair();
    const notOwner = await create(house.users[2].token, house.houseId, exchange(a, b)).expect(403);
    expect(notOwner.body.code).toBe('NOT_SLOT_OWNER');

    const other = await pair();
    await create(house.users[0].token, house.houseId, exchange(a, other.b)).expect(404);
  });

  it('chỉ người nhận đích danh mới accept được; người khác 403 NOT_SWAP_TARGET', async () => {
    const { house, a, b } = await pair();
    const created = await create(house.users[0].token, house.houseId, exchange(a, b)).expect(201);
    const res = await act(house.users[2].token, created.body.id, 'accept').expect(403);
    expect(res.body.code).toBe('NOT_SWAP_TARGET');
    await act(house.users[1].token, created.body.id, 'accept').expect(200);
  });

  it('cancel: chỉ người gửi, xóa SwapLock; người nhận gọi cancel bị 403 NOT_REQUESTER', async () => {
    const { house, a, b } = await pair();
    const created = await create(house.users[0].token, house.houseId, exchange(a, b)).expect(201);
    const denied = await act(house.users[1].token, created.body.id, 'cancel', null).expect(403);
    expect(denied.body.code).toBe('NOT_REQUESTER');

    await act(house.users[0].token, created.body.id, 'cancel', null).expect(200);
    const row = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row).toMatchObject({ status: 'CANCELLED', resolution: 'CANCELLED_BY_REQUESTER' });
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(0);
    // Sau khi hủy, ca được gửi lại được.
    await create(house.users[0].token, house.houseId, exchange(a, b)).expect(201);
  });

  it('reject: chỉ người nhận, xóa SwapLock; sau 2 lần bị từ chối cùng ca thì 422 SWAP_TARGET_COOLDOWN', async () => {
    const { house, a, b } = await pair();
    for (let i = 0; i < 2; i++) {
      const created = await create(house.users[0].token, house.houseId, exchange(a, b)).expect(201);
      if (i === 0) await act(house.users[0].token, created.body.id, 'reject', null).expect(403);
      await act(house.users[1].token, created.body.id, 'reject', null, { reason: 'Mình không rảnh' }).expect(200);
      const row = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(row).toMatchObject({ status: 'REJECTED', resolution: 'REJECTED_BY_TARGET', rejectReason: 'Mình không rảnh' });
    }
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(0);
    const res = await create(house.users[0].token, house.houseId, exchange(a, b)).expect(422);
    expect(res.body.code).toBe('SWAP_TARGET_COOLDOWN');
  });

  it('accept khi ca đã đổi version từ chỗ khác: đóng yêu cầu CANCELLED (SLOT_CHANGED), trả 409', async () => {
    const { house, a, b } = await pair();
    const created = await create(house.users[0].token, house.houseId, exchange(a, b)).expect(201);
    await fx.prisma.choreAssignment.update({ where: { id: a.id }, data: { version: { increment: 1 } } });

    const res = await act(house.users[1].token, created.body.id, 'accept').expect(409);
    expect(res.body.code).toBe('SLOT_CHANGED');
    const row = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row).toMatchObject({ status: 'CANCELLED', resolution: 'SLOT_CHANGED' });
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(0);
  });

  it('accept khi người nhận vắng đúng ngày ca sẽ nhận (kiểm lại lúc accept): 409 SLOT_CHANGED', async () => {
    const { house, a, b } = await pair();
    const created = await create(house.users[0].token, house.houseId, exchange(a, b)).expect(201);
    await fx.prisma.memberAbsence.create({
      data: {
        houseId: house.houseId,
        userId: house.users[1].id,
        startDate: new Date(`${day(1)}T00:00:00Z`),
        endDate: new Date(`${day(1)}T00:00:00Z`),
        createdById: house.users[0].id,
      },
    });
    const res = await act(house.users[1].token, created.body.id, 'accept').expect(409);
    expect(res.body).toMatchObject({ code: 'SLOT_CHANGED', reasonCode: 'TARGET_ABSENT' });
  });

  it('giới hạn: tối đa 3 yêu cầu PENDING mỗi người (429 SWAP_PENDING_LIMIT)', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện']);
    const mine = [];
    const theirs = [];
    for (let i = 0; i < 4; i++) {
      mine.push(await slot(house, 0, day(i % 3), 2).then(async (s) => s));
      theirs.push(await slot(house, 1, day(3 + (i % 3)), 2));
    }
    for (let i = 0; i < 3; i++) await create(house.users[0].token, house.houseId, exchange(mine[i], theirs[i])).expect(201);
    const res = await create(house.users[0].token, house.houseId, exchange(mine[3], theirs[3])).expect(429);
    expect(res.body.code).toBe('SWAP_PENDING_LIMIT');
  });

  it('lỗi giữa chừng khi accept (activity.record ném lỗi): không phát sự kiện, không ghi hoạt động, yêu cầu vẫn PENDING', async () => {
    const { house, a, b } = await pair();
    const created = await create(house.users[0].token, house.houseId, exchange(a, b)).expect(201);
    const sendSpy = vi.spyOn(events, 'send');
    vi.spyOn(fx.app.get(ActivityService), 'record').mockRejectedValueOnce(new Error('boom'));

    await act(house.users[1].token, created.body.id, 'accept').expect(500);
    expect(sendSpy.mock.calls.map((c) => (c[1] as { type: string }).type)).not.toContain('swap:accepted');
    expect(await fx.prisma.houseActivity.count({ where: { houseId: house.houseId, type: 'swap.accepted' } })).toBe(0);
    const row = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.status).toBe('PENDING');
    expect(await fx.prisma.swapLock.count({ where: { assignmentId: { in: [a.id, b.id] } } })).toBe(2);
    const untouched = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } });
    expect(untouched.assigneeId).toBe(house.memberId(house.users[0]));
  });

  it('T-SW-09 (property): 1.000 bước ngẫu nhiên giữ nguyên I1, I3, I4, I5', async () => {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
    const slots = [];
    for (let i = 0; i < 16; i++) slots.push(await slot(house, i % 4, day(i % 7), 1 + ((i * 3) % 5)));
    const slotIds = slots.map((s) => s.id);
    const totalWeight = slots.reduce((n, s) => n + s.weightSnapshot, 0);

    // PRNG có seed cố định để tái lập (mulberry32).
    let t = 0x9e3779b9;
    const rnd = () => {
      t = (t + 0x6d2b79f5) | 0;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    const REAL_ERRORS = new Set(['SLOT_LOCKED', 'SWAP_PENDING_LIMIT', 'SWAP_DAILY_LIMIT', 'SWAP_TARGET_COOLDOWN', 'DUPLICATE_CHORE_SAME_DAY', 'SWAP_NOT_PENDING', 'SLOT_CHANGED', 'SWAP_EXPIRED', 'SLOT_NOT_SWAPPABLE', 'SWAP_SELF', 'SWAP_IDENTICAL_SLOT']);
    const tolerate = async <T>(p: Promise<T>) => {
      try {
        return await p;
      } catch (e) {
        const code = e instanceof HttpException ? (e.getResponse() as { code?: string }).code : undefined;
        if (!code || !REAL_ERRORS.has(code)) throw e;
        return null;
      }
    };
    const stats = { created: 0, accepted: 0, rejected: 0, cancelled: 0, expired: 0 };

    for (let step = 0; step < 1000; step++) {
      // Lùi mốc thời gian của các yêu cầu cũ để giới hạn ngày và cooldown không chặn hết các bước sau.
      if (step % 20 === 0) {
        const back = new Date(Date.now() - 3 * 24 * 3_600_000);
        await fx.prisma.choreSwapRequest.updateMany({ where: { houseId: house.houseId }, data: { createdAt: back } });
        await fx.prisma.choreSwapRequest.updateMany({ where: { houseId: house.houseId, closedAt: { not: null } }, data: { closedAt: back } });
      }
      const rows = await fx.prisma.choreAssignment.findMany({ where: { id: { in: slotIds } } });
      const pending = await fx.prisma.choreSwapRequest.findMany({ where: { houseId: house.houseId, status: 'PENDING' } });
      const action = rnd();
      if (action < 0.4 || pending.length === 0) {
        const requester = pick([0, 1, 2, 3]);
        const mineRows = rows.filter((r) => r.assigneeId === house.memberId(house.users[requester]));
        const theirRows = rows.filter((r) => r.assigneeId !== house.memberId(house.users[requester]));
        const out = await tolerate(
          swaps.create(membership(house, requester), exchange(pick(mineRows), pick(theirRows), { acknowledgedWarnings: ALL_WARNINGS }) as never, randomUUID()),
        );
        if (out?.created) stats.created++;
      } else {
        const swap = pick(pending);
        const target = house.users.findIndex((u) => house.memberId(u) === swap.targetMemberId);
        const requester = house.users.findIndex((u) => house.memberId(u) === swap.requesterMemberId);
        if (action < 0.7) {
          const expire = rnd() < 0.15;
          const before = rows.filter((r) => [swap.fromAssignmentId, swap.toAssignmentId].includes(r.id));
          const sumBefore = before.filter((r) => r.assigneeId === swap.requesterMemberId || r.assigneeId === swap.targetMemberId).reduce((n, r) => n + r.weightSnapshot, 0);
          const out = await tolerate(swaps.accept(membership(house, target), swap.id, randomUUID(), expire ? new Date(Date.now() + 3 * 24 * 3_600_000) : new Date()));
          if (out) {
            stats.accepted++;
            const after = await fx.prisma.choreAssignment.findMany({ where: { id: { in: before.map((r) => r.id) } } });
            // I4: hai thành viên tham gia vẫn giữ đúng tổng độ nặng của hai ca.
            const sumAfter = after.filter((r) => r.assigneeId === swap.requesterMemberId || r.assigneeId === swap.targetMemberId).reduce((n, r) => n + r.weightSnapshot, 0);
            expect(sumAfter).toBe(sumBefore);
          } else {
            const now = await fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id: swap.id } });
            if (now.status === 'EXPIRED') stats.expired++;
          }
        } else if (action < 0.85) {
          if (await tolerate(swaps.reject(membership(house, target), swap.id, undefined))) stats.rejected++;
        } else if (await tolerate(swaps.cancel(membership(house, requester), swap.id))) stats.cancelled++;
      }

      // Bất biến sau mỗi bước.
      const [locks, allPending, after] = await Promise.all([
        fx.prisma.swapLock.findMany({ where: { assignmentId: { in: slotIds } } }),
        fx.prisma.choreSwapRequest.findMany({ where: { houseId: house.houseId, status: 'PENDING' } }),
        fx.prisma.choreAssignment.findMany({ where: { id: { in: slotIds } } }),
      ]);
      // I1: mỗi ca tối đa một khóa.
      expect(new Set(locks.map((l) => l.assignmentId)).size).toBe(locks.length);
      // I5: mọi PENDING có khóa cho đủ ca của nó, và mọi khóa thuộc một yêu cầu PENDING.
      const expectedLocks = allPending.flatMap((p) => [p.fromAssignmentId, p.toAssignmentId]).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
      expect(locks.map((l) => l.assignmentId).sort((a, b) => a.localeCompare(b))).toEqual(expectedLocks);
      expect(locks.every((l) => allPending.some((p) => p.id === l.swapRequestId))).toBe(true);
      // I3: mỗi ca đúng một người làm; I4 (toàn cục): không ca nào mất, tổng độ nặng không đổi.
      expect(after.every((r) => r.assigneeId !== null)).toBe(true);
      expect(after.reduce((n, r) => n + r.weightSnapshot, 0)).toBe(totalWeight);
    }
    // Chuỗi ngẫu nhiên phải thật sự đi qua các nhánh, không phải toàn bị chặn.
    expect(stats.created).toBeGreaterThan(50);
    expect(stats.accepted).toBeGreaterThan(10);
    expect(stats.rejected + stats.cancelled).toBeGreaterThan(10);
    expect(stats.expired).toBeGreaterThan(0);
  }, 600_000);
});

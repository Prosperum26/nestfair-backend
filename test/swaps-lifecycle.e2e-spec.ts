import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { vi } from 'vitest';
import { ScheduleService } from '../src/modules/chores/schedule.service.js';
import { addDays, currentWeekStart, openAtOf, weekKeyFromStart } from '../src/modules/chores/week.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { ChoreCronService } from '../src/modules/scheduler/chore-cron.service.js';
import { SwapLifecycleService } from '../src/modules/swaps/swap-lifecycle.service.js';
import { SwapsService } from '../src/modules/swaps/swaps.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { HOUR, makeAssignment, png } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;
type House = Awaited<ReturnType<Fx['houseWith']>>;

const ALL_WARNINGS = ['WEIGHT_GAP', 'FENCE_REPEAT', 'OVER_DAILY_CAP', 'CONSECUTIVE_DAY', 'DUE_SOON'];

describe('Vòng đời yêu cầu đổi ca quanh ca trực (e2e)', () => {
  let fx: Fx;
  let swaps: SwapsService;
  let lifecycle: SwapLifecycleService;
  let events: EventsService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-swaps-lifecycle.nestfair.test', (b) =>
      b.overrideProvider(CloudinaryService).useValue({ upload: vi.fn().mockResolvedValue({ url: 'https://res.cloudinary.test/p.jpg', publicId: 'p' }), destroy: vi.fn() }),
    );
    swaps = fx.app.get(SwapsService);
    lifecycle = fx.app.get(SwapLifecycleService);
    events = fx.app.get(EventsService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await fx.prisma.swapLock.deleteMany({});
    await fx.cleanup();
  });

  const membership = (house: House, i: number) => ({
    id: house.memberId(house.users[i]),
    houseId: house.houseId,
    userId: house.users[i].id,
    role: i === 0 ? ('ADMIN' as const) : ('ROOMMATE' as const),
  });

  /** Hai ca cùng ngày (hôm qua, cửa sổ nộp ảnh đã mở) nhưng hạn còn xa, rồi một yêu cầu EXCHANGE giữa họ. */
  async function pending(names = ['Hùng', 'Thiện', 'Mai']) {
    const house = await fx.houseWith(names);
    const a = await makeAssignment(fx, house, { assignee: 0, dueAt: new Date(Date.now() + 2 * 24 * HOUR) }, { weight: 2 });
    const b = await makeAssignment(fx, house, { assignee: 1, dueAt: new Date(Date.now() + 3 * 24 * HOUR) }, { weight: 2 });
    const { swap } = await swaps.create(
      membership(house, 0),
      { type: 'EXCHANGE', fromAssignmentId: a.id, toAssignmentId: b.id, acknowledgedWarnings: ALL_WARNINGS },
      randomUUID(),
    );
    return { house, a, b, swapId: swap.id };
  }
  const locks = (ids: string[]) => fx.prisma.swapLock.count({ where: { assignmentId: { in: ids } } });
  const swapRow = (id: string) => fx.prisma.choreSwapRequest.findUniqueOrThrow({ where: { id } });
  const checkin = (token: string, assignmentId: string) =>
    fx.as(token).post(`/api/v1/assignments/${assignmentId}/checkin`).attach('photo', png(), { filename: 'p.png', contentType: 'image/png' });

  it('SW-27: chủ ca tự check-in ca đang chờ đổi thì yêu cầu bị hủy REQUESTER_DID_IT và người nhận nhận swap:cancelled', async () => {
    const { house, a, b, swapId } = await pending();
    const send = vi.spyOn(events, 'send');
    await checkin(house.users[0].token, a.id).expect(200);

    expect(await swapRow(swapId)).toMatchObject({ status: 'CANCELLED', resolution: 'REQUESTER_DID_IT' });
    expect(await locks([a.id, b.id])).toBe(0);
    const rooms = send.mock.calls.filter((c) => (c[1] as { type: string }).type === 'swap:cancelled').map((c) => c[0]);
    expect(rooms).toContain(`user:${house.users[1].id}`);
    expect(rooms).toContain(`user:${house.users[0].id}`);
  });

  it('SW-27: chủ ca đích (người nhận) check-in thì yêu cầu bị hủy SLOT_CHANGED', async () => {
    const { house, a, b, swapId } = await pending();
    await checkin(house.users[1].token, b.id).expect(200);
    expect(await swapRow(swapId)).toMatchObject({ status: 'CANCELLED', resolution: 'SLOT_CHANGED' });
    expect(await locks([a.id, b.id])).toBe(0);
  });

  it('check-in thất bại (ca không ở trạng thái nộp được) không hủy yêu cầu', async () => {
    const { house, a, swapId } = await pending();
    const other = await makeAssignment(fx, house, { assignee: 2, status: 'DONE' });
    await checkin(house.users[2].token, other.id).expect(409);
    expect(await swapRow(swapId)).toMatchObject({ status: 'PENDING' });
    expect(await locks([a.id])).toBe(1);
  });

  it('IN-07: markMissed hủy yêu cầu PENDING của ca trước khi đánh MISSED (SLOT_CHANGED)', async () => {
    const { house, a, b, swapId } = await pending();
    await fx.prisma.choreAssignment.update({ where: { id: a.id }, data: { dueAt: new Date(Date.now() - 5 * HOUR) } });
    const n = await fx.app.get(ChoreCronService).markMissed(new Date(), [house.houseId]);
    expect(n).toBe(1);
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('MISSED');
    expect(await swapRow(swapId)).toMatchObject({ status: 'CANCELLED', resolution: 'SLOT_CHANGED' });
    expect(await locks([a.id, b.id])).toBe(0);
  });

  it('SW-39: cancelPendingForMember hủy mọi PENDING của người đó (gửi hoặc nhận) với MEMBER_LEFT', async () => {
    const { house, a, b, swapId } = await pending();
    const c = await makeAssignment(fx, house, { assignee: 2, dueAt: new Date(Date.now() + 2 * 24 * HOUR) }, { weight: 2 });
    const d = await makeAssignment(fx, house, { assignee: 1, dueAt: new Date(Date.now() + 2 * 24 * HOUR) }, { weight: 2 });
    const { swap: second } = await swaps.create(
      membership(house, 2),
      { type: 'EXCHANGE', fromAssignmentId: c.id, toAssignmentId: d.id, acknowledgedWarnings: ALL_WARNINGS },
      randomUUID(),
    );
    const thien = house.memberId(house.users[1]);

    const outbox = events.outbox();
    const ids = await fx.prisma.$transaction((tx) => lifecycle.cancelPendingForMember(tx, outbox, thien, 'MEMBER_LEFT'));
    outbox.flush();

    expect(ids.sort()).toEqual([swapId, second.id].sort());
    expect(await swapRow(swapId)).toMatchObject({ status: 'CANCELLED', resolution: 'MEMBER_LEFT' });
    expect(await swapRow(second.id)).toMatchObject({ status: 'CANCELLED', resolution: 'MEMBER_LEFT' });
    expect(await locks([a.id, b.id, c.id, d.id])).toBe(0);
  });

  describe('SW-34: re-roll lịch tuần có yêu cầu đang chờ', () => {
    const next = addDays(currentWeekStart(), 7);
    const monday = openAtOf(currentWeekStart());

    it('re-roll bị 409 SWAP_PENDING_IN_WEEK; Admin hủy hàng loạt rồi re-roll được; thành viên thường bị 403', async () => {
      const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
      for (const title of ['A', 'B', 'C', 'D']) {
        await fx.prisma.chore.create({ data: { houseId: house.houseId, title, weight: 2, recurrenceDays: [7], dueTime: '21:00' } });
      }
      const schedule = fx.app.get(ScheduleService);
      await schedule.createSchedule(house.houseId, next, monday);
      const rows = await fx.prisma.choreAssignment.findMany({ where: { houseId: house.houseId }, orderBy: { id: 'asc' } });
      const from = rows[0];
      const to = rows.find((r) => r.assigneeId !== from.assigneeId)!;
      const requester = house.users.findIndex((u) => house.memberId(u) === from.assigneeId);
      await swaps.create(
        membership(house, requester),
        { type: 'EXCHANGE', fromAssignmentId: from.id, toAssignmentId: to.id, acknowledgedWarnings: ALL_WARNINGS },
        randomUUID(),
        monday,
      );

      const admin = { memberId: house.memberId(house.users[0]), role: 'ADMIN' as const };
      const err = await schedule.rerollSchedule(house.houseId, next, admin, monday).then(() => null, (e: unknown) => e as HttpException);
      expect(err?.getStatus()).toBe(409);
      expect(err?.getResponse()).toMatchObject({ code: 'SWAP_PENDING_IN_WEEK' });
      expect((err!.getResponse() as { swapIds: string[] }).swapIds).toHaveLength(1);

      const week = weekKeyFromStart(next);
      await fx.as(house.users[1].token).delete(`/api/v1/houses/${house.houseId}/swaps/pending?week=${week}`).expect(403);
      const del = await fx.as(house.users[0].token).delete(`/api/v1/houses/${house.houseId}/swaps/pending?week=${week}`).expect(200);
      expect(del.body).toEqual({ cancelled: 1 });
      expect(await fx.prisma.choreSwapRequest.count({ where: { houseId: house.houseId, status: 'PENDING' } })).toBe(0);
      expect(await locks([from.id, to.id])).toBe(0);
      expect(await fx.prisma.choreSwapRequest.findFirstOrThrow({ where: { houseId: house.houseId } })).toMatchObject({ resolution: 'ADMIN_OVERRIDE' });
      expect(await fx.prisma.choreAuditLog.count({ where: { houseId: house.houseId, action: 'CANCEL_PENDING_SWAPS' } })).toBe(1);

      await expect(schedule.rerollSchedule(house.houseId, next, admin, monday)).resolves.toBeTruthy();
    });

    it('week sai định dạng nhận 400', async () => {
      const house = await fx.houseWith(['Hùng', 'Thiện']);
      await fx.as(house.users[0].token).delete(`/api/v1/houses/${house.houseId}/swaps/pending?week=abc`).expect(400);
    });
  });
});

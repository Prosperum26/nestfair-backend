import { vi } from 'vitest';
import { ActivityService } from '../src/modules/activity/activity.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { ChoreCronService } from '../src/modules/scheduler/chore-cron.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { assignmentIn, HOUR, makeAssignment, png } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

describe('Live Ticker / HouseActivity (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const upload = vi.fn();

  beforeAll(async () => {
    fx = await createFixture('@e2e-activity.nestfair.test', (b) =>
      b.overrideProvider(CloudinaryService).useValue({ upload, destroy: vi.fn() }),
    );
  });
  beforeEach(() => upload.mockResolvedValue({ url: 'https://res.cloudinary.test/p.jpg', publicId: 'p' }));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const feed = (token: string, houseId: string, q = '') => fx.as(token).get(`/api/v1/houses/${houseId}/activity${q}`);
  const rows = (houseId: string) => fx.prisma.houseActivity.findMany({ where: { houseId }, orderBy: { createdAt: 'asc' } });
  /** houseWith tự ghi member.joined (vào bằng mã mời): xóa để mỗi test bắt đầu với ticker trống. */
  const clear = async <T extends { houseId: string }>(h: T): Promise<T> => {
    await fx.prisma.houseActivity.deleteMany({ where: { houseId: h.houseId } });
    return h;
  };
  const sentTypes = (spy: { mock: { calls: unknown[][] } }): string[] => spy.mock.calls.map((c) => (c[1] as { type: string }).type);

  it('check-in ghi một mục chore.submitted và phát activity:new; F5 (GET) vẫn còn (TK-01)', async () => {
    const h = await clear(await assignmentIn(fx, ['Hùng', 'Mai'], {}, { title: 'Rửa chén tối' }));
    const send = vi.spyOn(fx.app.get(EventsService), 'send');
    await fx
      .as(h.users[1].token)
      .post(`/api/v1/assignments/${h.assignment.id}/checkin`)
      .attach('photo', png(), { filename: 'a.png', contentType: 'image/png' })
      .expect(200);

    expect(sentTypes(send)).toEqual(['activity:new', 'chore:submitted']);
    const res = await feed(h.users[0].token, h.houseId).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      type: 'chore.submitted',
      actorUserId: h.users[1].id,
      actorName: 'Mai',
      params: { choreTitle: 'Rửa chén tối', assignmentId: h.assignment.id },
    });
  });

  it('T-RT-03: transaction rollback giữa chừng thì không có sự kiện, không có HouseActivity, ca giữ nguyên', async () => {
    const h = await clear(await assignmentIn(fx, ['Hùng', 'Thiện'], { status: 'PENDING_VERIFY', submittedAt: new Date() }));
    const send = vi.spyOn(fx.app.get(EventsService), 'send');
    vi.spyOn(fx.app.get(ActivityService), 'record').mockRejectedValueOnce(new Error('boom'));
    await fx.as(h.users[0].token).patch(`/api/v1/assignments/${h.assignment.id}/verify`, { decision: 'APPROVED' }).expect(500);

    expect(send).not.toHaveBeenCalled();
    expect(await rows(h.houseId)).toHaveLength(0);
    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: h.assignment.id } })).status).toBe('PENDING_VERIFY');
  });

  it('TK-03: yêu cầu làm lại lên ticker nhưng KHÔNG kèm lý do', async () => {
    const h = await clear(await assignmentIn(fx, ['Hùng', 'Mai'], { status: 'PENDING_VERIFY', submittedAt: new Date() }, { title: 'Đổ rác' }));
    await fx
      .as(h.users[0].token)
      .patch(`/api/v1/assignments/${h.assignment.id}/verify`, { decision: 'REJECTED', reason: 'Ảnh mờ, chưa thấy thùng rác' })
      .expect(200);
    const [row] = await rows(h.houseId);
    expect(row).toMatchObject({ type: 'chore.rejected', actorName: 'Hùng', params: { choreTitle: 'Đổ rác', targetName: 'Mai' } });
    expect(JSON.stringify(row.params)).not.toContain('Ảnh mờ');
  });

  it('T-RT-06: cron sinh lịch 21 ca → đúng 1 HouseActivity và 1 chore:shuffled (TK-02)', async () => {
    const h = await clear(await fx.houseWith(['Hùng', 'Thiện', 'Mai']));
    const admin = fx.as(h.users[0].token);
    for (const title of ['Rửa chén', 'Đổ rác', 'Quét nhà']) {
      await admin.post(`/api/v1/houses/${h.houseId}/chores`, { title, weight: 2, frequency: 'DAILY' }).expect(201);
    }
    const send = vi.spyOn(fx.app.get(EventsService), 'send');
    const res = await fx.app.get(ChoreCronService).generateNextWeek(new Date(), [h.houseId]);
    expect(res.created).toBe(1);

    const slots = await fx.prisma.choreAssignment.count({ where: { houseId: h.houseId } });
    expect(slots).toBe(21);
    const acts = await rows(h.houseId);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ type: 'schedule.generated', actorUserId: null, actorName: 'NestFair' });
    expect(sentTypes(send).filter((t) => t === 'chore:shuffled')).toHaveLength(1);
    expect(sentTypes(send).filter((t) => t === 'activity:new')).toHaveLength(1);
  });

  it('cron đánh dấu nhiều ca quá hạn: một mục mỗi người ("Quân bỏ 2 ca")', async () => {
    const h = await clear(await assignmentIn(fx, ['Hùng', 'Quân'], { dueAt: new Date(Date.now() - 5 * HOUR) }));
    await makeAssignment(fx, h, { dueAt: new Date(Date.now() - 5 * HOUR) });
    await fx.app.get(ChoreCronService).markMissed(new Date(), [h.houseId]);
    const acts = await rows(h.houseId);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ type: 'chore.missed', actorUserId: h.users[1].id, actorName: 'Quân', params: { count: 2 } });
  });

  it('T-RT-04: ?since= trả đủ mục bị lỡ, không trùng; before để cuộn thêm; limit', async () => {
    const h = await clear(await fx.houseWith(['Hùng', 'Thiện']));
    const base = Date.now() - 10 * 60_000;
    for (let i = 0; i < 6; i++) {
      await fx.prisma.houseActivity.create({
        data: { houseId: h.houseId, type: 'member.joined', actorName: `N${i}`, params: {}, createdAt: new Date(base + i * 1000) },
      });
    }
    const all = (await feed(h.users[1].token, h.houseId).expect(200)).body as { id: string; actorName: string; createdAt: string }[];
    expect(all.map((a) => a.actorName)).toEqual(['N5', 'N4', 'N3', 'N2', 'N1', 'N0']);

    const since = all[3].createdAt; // đã thấy tới N2
    const missed = (await feed(h.users[1].token, h.houseId, `?since=${encodeURIComponent(since)}`).expect(200)).body as { actorName: string }[];
    expect(missed.map((a) => a.actorName)).toEqual(['N5', 'N4', 'N3']);

    const page = (await feed(h.users[1].token, h.houseId, `?limit=2&before=${encodeURIComponent(all[1].createdAt)}`).expect(200)).body as { actorName: string }[];
    expect(page.map((a) => a.actorName)).toEqual(['N3', 'N2']);

    await feed(h.users[1].token, h.houseId, '?limit=0').expect(400);
    await feed(h.users[1].token, h.houseId, '?since=hôm-qua').expect(400);
  });

  it('ADMIN_ONLY chỉ trưởng phòng thấy; người ngoài nhà bị chặn', async () => {
    const h = await clear(await fx.houseWith(['Hùng', 'Thiện']));
    const stranger = await fx.user('Người lạ');
    await fx.prisma.houseActivity.create({
      data: { houseId: h.houseId, type: 'chore.missed_streak', actorName: 'NestFair', params: { targetName: 'Thiện' }, visibility: 'ADMIN_ONLY' },
    });
    expect((await feed(h.users[0].token, h.houseId).expect(200)).body).toHaveLength(1);
    expect((await feed(h.users[1].token, h.houseId).expect(200)).body).toHaveLength(0);
    await feed(stranger.token, h.houseId).expect(403);
  });

  it('TK-04: cùng dedupeKey chỉ ghi một lần, lần sau không phát sự kiện', async () => {
    const h = await clear(await fx.houseWith(['Hùng', 'Thiện']));
    const svc = fx.app.get(ActivityService);
    const events = fx.app.get(EventsService);
    const input = { houseId: h.houseId, type: 'schedule.generated' as const, actor: null, params: { weekKey: '2026-W44' }, dedupeKey: 'schedule:x:0' };
    const first = events.outbox();
    const second = events.outbox();
    expect(await fx.prisma.$transaction((tx) => svc.record(tx, first, input))).not.toBeNull();
    expect(await fx.prisma.$transaction((tx) => svc.record(tx, second, input))).toBeNull();
    expect(first.size).toBe(1);
    expect(second.size).toBe(0);
    expect(await rows(h.houseId)).toHaveLength(1);
  });

  it('TK-09: dọn mục cũ hơn 30 ngày', async () => {
    const h = await clear(await fx.houseWith(['Hùng', 'Thiện']));
    await fx.prisma.houseActivity.createMany({
      data: [
        { houseId: h.houseId, type: 'member.joined', actorName: 'Cũ', params: {}, createdAt: new Date(Date.now() - 31 * 24 * HOUR) },
        { houseId: h.houseId, type: 'member.joined', actorName: 'Mới', params: {}, createdAt: new Date(Date.now() - 29 * 24 * HOUR) },
      ],
    });
    expect(await fx.app.get(ActivityService).cleanup(new Date(), [h.houseId])).toBe(1);
    expect((await rows(h.houseId)).map((r) => r.actorName)).toEqual(['Mới']);
  });

  it('vào nhà bằng mã mời ghi member.joined', async () => {
    const h = await fx.houseWith(['Hùng', 'Quân']);
    const acts = await rows(h.houseId);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ type: 'member.joined', actorUserId: h.users[1].id, actorName: 'Quân' });
  });
});

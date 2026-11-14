import { vi } from 'vitest';
import { ScheduleService } from '../src/modules/chores/schedule.service.js';
import { addDays, currentWeekStart, openAtOf } from '../src/modules/chores/week.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { createFixture } from './support/house-fixture.js';

describe('Chores (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  beforeAll(async () => {
    fx = await createFixture('@e2e-chores.nestfair.test');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const url = (houseId: string, tail = '') => `/api/v1/houses/${houseId}/chores${tail}`;

  it('ADMIN tạo việc → 201 kèm mặc định; ROOMMATE tạo → 403', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const ok = await fx.as(users[0].token).post(url(houseId), { title: '  Đổ rác ', weight: 2, frequency: 'WEEKLY', recurrenceDays: [4] }).expect(201);
    expect(ok.body).toMatchObject({
      title: 'Đổ rác',
      weight: 2,
      frequency: 'WEEKLY',
      recurrenceDays: [4],
      dueTime: '21:00',
      rotationMode: 'WEEK_BLOCK',
      occurrenceGap: 1,
      isActive: true,
    });
    await fx.as(users[1].token).post(url(houseId), { title: 'Lau nhà', weight: 3, frequency: 'WEEKLY', recurrenceDays: [6] }).expect(403);
  });

  it('chế độ xoay mặc định theo số ngày lặp; Admin chọn rõ thì giữ nguyên', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const admin = fx.as(users[0].token);
    const daily = await admin.post(url(houseId), { title: 'Rửa chén', weight: 2, frequency: 'DAILY', dueTime: '22:00' }).expect(201);
    expect(daily.body).toMatchObject({ recurrenceDays: [1, 2, 3, 4, 5, 6, 7], rotationMode: 'PER_OCCURRENCE', dueTime: '22:00' });
    const three = await admin.post(url(houseId), { title: 'Tưới cây', weight: 1, frequency: 'WEEKLY', recurrenceDays: [5, 1, 3] }).expect(201);
    expect(three.body).toMatchObject({ recurrenceDays: [1, 3, 5], rotationMode: 'PER_OCCURRENCE' });
    const forced = await admin.post(url(houseId), { title: 'Lau bếp', weight: 2, frequency: 'WEEKLY', recurrenceDays: [1, 3, 5], rotationMode: 'WEEK_BLOCK' }).expect(201);
    expect(forced.body.rotationMode).toBe('WEEK_BLOCK');
    const adhoc = await admin.post(url(houseId), { title: 'Việc đột xuất', weight: 2, frequency: 'ADHOC' }).expect(201);
    expect(adhoc.body.recurrenceDays).toEqual([]);
  });

  it('dữ liệu sai → 400: ngày, giờ, weight, tên, field lạ, WEEKLY không ngày, gap', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const post = (body: object) => fx.as(users[0].token).post(url(houseId), body);
    const ok = { title: 'A', weight: 2, frequency: 'WEEKLY', recurrenceDays: [1] };
    await post({ ...ok, recurrenceDays: [8] }).expect(400);
    await post({ ...ok, recurrenceDays: [0] }).expect(400);
    await post({ ...ok, recurrenceDays: [1, 1.5] }).expect(400);
    await post({ ...ok, dueTime: '25:00' }).expect(400);
    await post({ ...ok, dueTime: '9:00' }).expect(400);
    await post({ ...ok, weight: 6 }).expect(400);
    await post({ ...ok, weight: 0 }).expect(400);
    await post({ ...ok, title: '   ' }).expect(400);
    await post({ ...ok, isActive: false }).expect(400);
    await post({ ...ok, recurrenceDays: [] }).expect(400);
    await post({ ...ok, occurrenceGap: 0 }).expect(400);
    await post({ ...ok, occurrenceGap: 9 }).expect(400);
    await post({ ...ok, frequency: 'MONTHLY' }).expect(400);
  });

  it('người ngoài nhà không đọc được danh sách (403)', async () => {
    const { houseId } = await fx.houseWith(['Hùng', 'Thiện']);
    const outsider = await fx.user('Người lạ');
    await fx.as(outsider.token).get(url(houseId)).expect(403);
  });

  it('PATCH đổi tên/weight/giờ/ngày; việc đã tắt ẩn khỏi danh sách mặc định', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const admin = fx.as(users[0].token);
    const created = await admin.post(url(houseId), { title: 'Rửa chén', weight: 2, frequency: 'WEEKLY', recurrenceDays: [2] });
    const id = created.body.id as string;
    const patched = await admin.patch(url(houseId, `/${id}`), { weight: 4, dueTime: '20:15', recurrenceDays: [2, 5] }).expect(200);
    expect(patched.body).toMatchObject({ weight: 4, dueTime: '20:15', recurrenceDays: [2, 5] });
    await admin.patch(url(houseId, `/${id}`), { isActive: false }).expect(200);
    expect((await fx.as(users[1].token).get(url(houseId)).expect(200)).body).toEqual([]);
    expect((await fx.as(users[1].token).get(url(houseId, '?includeInactive=true')).expect(200)).body).toHaveLength(1);
    await admin.patch(url(houseId, `/${id}`), { frequency: 'WEEKLY', recurrenceDays: [] }).expect(400);
  });

  it('PATCH choreId của nhà khác → 404 (chống IDOR); member → 403', async () => {
    const a = await fx.houseWith(['Hùng', 'Thiện']);
    const b = await fx.houseWith(['Mai', 'Quân']);
    const chore = await fx.as(b.users[0].token).post(url(b.houseId), { title: 'X', weight: 1, frequency: 'WEEKLY', recurrenceDays: [1] });
    await fx.as(a.users[0].token).patch(url(a.houseId, `/${chore.body.id}`), { title: 'Hack' }).expect(404);
    await fx.as(b.users[1].token).patch(url(b.houseId, `/${chore.body.id}`), { title: 'Hack' }).expect(403);
  });

  it('S-27/S-28: sửa weight giữ snapshot ca đã sinh; tắt việc hủy ca TODO tương lai, không đụng ca DONE; ghi audit', async () => {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const admin = fx.as(h.users[0].token);
    const chore = (await admin.post(url(h.houseId), { title: 'Dọn bếp', weight: 2, frequency: 'DAILY' }).expect(201)).body;
    const next = addDays(currentWeekStart(), 7);
    await fx.app.get(ScheduleService).ensureSchedule(h.houseId, next, 'CRON', openAtOf(currentWeekStart()));
    const rows = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId }, orderBy: { occurrenceDate: 'asc' } });
    expect(rows).toHaveLength(7);
    await fx.prisma.choreAssignment.update({ where: { id: rows[0].id }, data: { status: 'DONE' } });

    await admin.patch(url(h.houseId, `/${chore.id}`), { weight: 5, title: 'Đổi tên' }).expect(200);
    const afterEdit = await fx.prisma.choreAssignment.findFirstOrThrow({ where: { id: rows[1].id } });
    expect(afterEdit).toMatchObject({ weightSnapshot: 2, titleSnapshot: 'Dọn bếp' });

    const emit = vi.spyOn(fx.app.get(EventsService), 'send');
    await admin.patch(url(h.houseId, `/${chore.id}`), { isActive: false }).expect(200);
    const after = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId }, orderBy: { occurrenceDate: 'asc' } });
    expect(after[0].status).toBe('DONE');
    expect(after.slice(1).every((a) => a.status === 'CANCELLED')).toBe(true);
    expect(emit).toHaveBeenCalledWith(`house:${h.houseId}`, expect.objectContaining({ type: 'chore:cancelled', payload: expect.objectContaining({ choreId: chore.id }) }));
    const actions = (await fx.prisma.choreAuditLog.findMany({ where: { houseId: h.houseId } })).map((l) => l.action).sort();
    expect(actions).toEqual(['CHORE_CREATED', 'CHORE_DEACTIVATED', 'CHORE_UPDATED']);
  });

  describe('chore-settings', () => {
    it('mặc định 3 giờ ân hạn và 2 ca/người/ngày; Admin chỉnh được, member 403', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const path = `/api/v1/houses/${houseId}/chore-settings`;
      expect((await fx.as(users[1].token).get(path).expect(200)).body).toEqual({ choreGraceHours: 3, maxSlotsPerPersonPerDay: 2 });
      const res = await fx.as(users[0].token).patch(path, { choreGraceHours: 6, maxSlotsPerPersonPerDay: 3 }).expect(200);
      expect(res.body).toEqual({ choreGraceHours: 6, maxSlotsPerPersonPerDay: 3 });
      await fx.as(users[1].token).patch(path, { choreGraceHours: 5 }).expect(403);
      for (const bad of [{ choreGraceHours: 0 }, { choreGraceHours: 25 }, { maxSlotsPerPersonPerDay: 0 }, { maxSlotsPerPersonPerDay: 7 }, { nope: 1 }]) {
        await fx.as(users[0].token).patch(path, bad).expect(400);
      }
      expect((await fx.as(users[1].token).get(path).expect(200)).body).toEqual({ choreGraceHours: 6, maxSlotsPerPersonPerDay: 3 });
    });
  });
});

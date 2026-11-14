import { vi } from 'vitest';
import { addDays, currentWeekStart, weekKeyFromStart } from '../src/modules/chores/week.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { createFixture } from './support/house-fixture.js';

describe('Schedule & assignments API (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const cur = currentWeekStart();
  const next = addDays(cur, 7);
  const curKey = weekKeyFromStart(cur);
  const nextKey = weekKeyFromStart(next);

  beforeAll(async () => {
    fx = await createFixture('@e2e-assignments.nestfair.test');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  async function house(names: string[], chores = 4) {
    const h = await fx.houseWith(names);
    for (let i = 0; i < chores; i++) {
      await fx.prisma.chore.create({
        data: { houseId: h.houseId, title: `Việc ${i + 1}`, weight: 2 + (i % 2), recurrenceDays: [7], dueTime: '21:00' },
      });
    }
    return h;
  }
  const get = (token: string, houseId: string, q = '') => fx.as(token).get(`/api/v1/houses/${houseId}/assignments${q}`);
  const shuffle = (token: string, houseId: string, body: object) => fx.as(token).post(`/api/v1/houses/${houseId}/assignments/shuffle`, body);
  const preview = (token: string, houseId: string, body: object) => fx.as(token).post(`/api/v1/houses/${houseId}/schedules/preview`, body);

  it('GET: week sai định dạng → 400; người ngoài nhà → 403', async () => {
    const h = await house(['Hùng', 'Thiện']);
    await get(h.users[0].token, h.houseId, '?week=abc').expect(400);
    await get(h.users[0].token, h.houseId, '?week=2026-W54').expect(400);
    const outsider = await fx.user('Người lạ');
    await get(outsider.token, h.houseId).expect(403);
  });

  it('GET tuần hiện tại chưa có lịch: sinh bù (CATCHUP) và trả { schedule, assignments }', async () => {
    const h = await house(['Hùng', 'Thiện', 'Mai']);
    const res = await get(h.users[1].token, h.houseId).expect(200);
    expect(res.body.schedule).toMatchObject({
      weekKey: curKey,
      weekStart: cur,
      status: 'LOCKED',
      generatedBy: 'CATCHUP',
      relaxed: false,
      rerollCount: 0,
    });
    expect(typeof res.body.schedule.seed).toBe('number');
    expect(res.body.assignments).toHaveLength(4);
    expect(res.body.assignments[0]).toMatchObject({
      weekKey: curKey,
      status: 'TODO',
      source: 'ROTATION',
      isLate: false,
      rejectCount: 0,
      disputed: false,
      verifyMode: null,
    });
    expect(res.body.assignments[0].originalAssigneeId).toBe(res.body.assignments[0].assigneeId);
    // Gọi lại không sinh thêm.
    const again = await get(h.users[0].token, h.houseId).expect(200);
    expect(again.body.schedule.id).toBe(res.body.schedule.id);
    expect(again.body.assignments).toHaveLength(4);
  });

  it('GET nhà chưa có việc: lịch EMPTY NO_CHORES, không có ca', async () => {
    const h = await house(['Hùng', 'Thiện'], 0);
    const res = await get(h.users[0].token, h.houseId).expect(200);
    expect(res.body.schedule).toMatchObject({ status: 'EMPTY', reasons: ['NO_CHORES'] });
    expect(res.body.assignments).toEqual([]);
  });

  it('GET tuần quá khứ hoặc xa hơn 1 tuần: không sinh lịch, trả schedule null', async () => {
    const h = await house(['Hùng', 'Thiện']);
    for (const ws of [addDays(cur, -7), addDays(cur, 21)]) {
      const res = await get(h.users[0].token, h.houseId, `?week=${weekKeyFromStart(ws)}`).expect(200);
      expect(res.body).toEqual({ schedule: null, assignments: [] });
    }
    expect(await fx.prisma.weekSchedule.count({ where: { houseId: h.houseId } })).toBe(0);
  });

  it('GET tuần sau chưa bắt đầu có trạng thái PUBLISHED', async () => {
    const h = await house(['Hùng', 'Thiện']);
    const res = await get(h.users[0].token, h.houseId, `?week=${nextKey}`).expect(200);
    expect(res.body.schedule.status).toBe('PUBLISHED');
  });

  it('preview: không ghi DB, trả seed + lý do; tuần ngoài phạm vi → 422', async () => {
    const h = await house(['Hùng', 'Thiện']);
    const res = await preview(h.users[1].token, h.houseId, { weekKey: curKey }).expect(201);
    expect(typeof res.body.seed).toBe('number');
    expect(res.body.slots).toHaveLength(4);
    expect(res.body.slots[0]).toMatchObject({ memberName: expect.any(String), memberUserId: expect.any(String), occurrenceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(Array.isArray(res.body.reasons)).toBe(true);
    expect(await fx.prisma.weekSchedule.count({ where: { houseId: h.houseId } })).toBe(0);
    const far = await preview(h.users[0].token, h.houseId, { weekKey: weekKeyFromStart(addDays(cur, 21)) }).expect(422);
    expect(far.body).toMatchObject({ code: 'WEEK_OUT_OF_RANGE', statusCode: 422 });
  });

  it('CREATE: thành viên thường tạo được; lần 2 trả lịch cũ (changed:false), không lỗi', async () => {
    const h = await house(['Hùng', 'Thiện']);
    const emit = vi.spyOn(fx.app.get(EventsService), 'send');
    const first = await shuffle(h.users[1].token, h.houseId, { weekKey: nextKey, mode: 'CREATE' }).expect(201);
    expect(first.body.changed).toBe(true);
    expect(first.body.assignments).toHaveLength(4);
    expect(emit).toHaveBeenCalledWith(`house:${h.houseId}`, expect.objectContaining({ type: 'chore:shuffled', payload: expect.objectContaining({ weekKey: nextKey, reasons: expect.any(Array) }) }));

    emit.mockClear();
    const second = await shuffle(h.users[0].token, h.houseId, { weekKey: nextKey, mode: 'CREATE' }).expect(201);
    expect(second.body.changed).toBe(false);
    expect(second.body.schedule.id).toBe(first.body.schedule.id);
    expect(emit).not.toHaveBeenCalled();
  });

  it('REROLL: thành viên thường 403 ADMIN_ONLY; tuần hiện tại (đã khóa) 409 SCHEDULE_LOCKED; Admin tuần sau đổi được', async () => {
    const h = await house(['Hùng', 'Thiện', 'Mai', 'Quân']);
    await shuffle(h.users[0].token, h.houseId, { weekKey: nextKey, mode: 'CREATE' }).expect(201);

    const denied = await shuffle(h.users[1].token, h.houseId, { weekKey: nextKey, mode: 'REROLL' }).expect(403);
    expect(denied.body).toMatchObject({ code: 'ADMIN_ONLY' });

    await get(h.users[0].token, h.houseId); // sinh bù tuần hiện tại
    const locked = await shuffle(h.users[0].token, h.houseId, { weekKey: curKey, mode: 'REROLL' }).expect(409);
    expect(locked.body).toMatchObject({ code: 'SCHEDULE_LOCKED' });

    const ok = await shuffle(h.users[0].token, h.houseId, { weekKey: nextKey, mode: 'REROLL' }).expect(201);
    expect(ok.body.changed).toBe(true);
    expect(ok.body.schedule).toMatchObject({ rerollCount: 1, generatedBy: 'ADMIN_REROLL' });
  });

  it('body shuffle sai: thiếu mode, mode lạ, weekKey sai → 400', async () => {
    const h = await house(['Hùng', 'Thiện']);
    await shuffle(h.users[0].token, h.houseId, { weekKey: curKey }).expect(400);
    await shuffle(h.users[0].token, h.houseId, { weekKey: curKey, mode: 'NOPE' }).expect(400);
    await shuffle(h.users[0].token, h.houseId, { weekKey: 'x', mode: 'CREATE' }).expect(400);
  });
});

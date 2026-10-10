import { vi } from 'vitest';
import { ChoreScheduleService } from '../src/modules/chores/chore-schedule.service.js';
import { shiftWeek, weekKeyOf, weekRange } from '../src/modules/chores/week.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { createFixture } from './support/house-fixture.js';

describe('Assignments: list & shuffle (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const thisWeek = weekKeyOf(new Date());

  beforeAll(async () => {
    fx = await createFixture('@e2e-assignments.nestfair.test');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  async function setup(names: string[], weights: number[]) {
    const house = await fx.houseWith(names);
    const chores = [];
    for (const [i, weight] of weights.entries()) {
      chores.push(
        await fx.prisma.chore.create({ data: { houseId: house.houseId, title: `Việc ${i + 1}`, weight } }),
      );
    }
    return { ...house, chores };
  }
  const shuffle = (token: string, houseId: string, body: object = {}) =>
    fx.as(token).post(`/api/v1/houses/${houseId}/assignments/shuffle`, body);
  const list = (token: string, houseId: string, query = '') =>
    fx.as(token).get(`/api/v1/houses/${houseId}/assignments${query}`);

  it('GET: tuần chưa có lịch trả mảng rỗng; người ngoài nhà 403; weekKey sai 400', async () => {
    const { houseId, users } = await setup(['Hùng', 'Thiện'], [2]);
    expect((await list(users[0].token, houseId).expect(200)).body).toEqual([]);
    const outsider = await fx.user('Người lạ');
    await list(outsider.token, houseId).expect(403);
    await list(users[0].token, houseId, '?weekKey=abc').expect(400);
    await list(users[0].token, houseId, '?weekKey=2026-W54').expect(400);
  });

  it('Shuffle: ROOMMATE 403; nhà chưa có việc 400', async () => {
    const empty = await setup(['Hùng', 'Thiện'], []);
    await shuffle(empty.users[0].token, empty.houseId).expect(400);
    const { houseId, users } = await setup(['Hùng', 'Thiện'], [2]);
    await shuffle(users[1].token, houseId).expect(403);
  });

  it('Shuffle: sinh đủ ca TODO cho tuần hiện tại, đúng hạn, emit chore:shuffled, GET khớp', async () => {
    const { houseId, users, chores } = await setup(['Hùng', 'Thiện'], [2, 2, 3, 3]);
    const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');

    const res = await shuffle(users[0].token, houseId).expect(201);
    expect(res.body.relaxed).toBe(false);
    expect(res.body.assignments).toHaveLength(4);
    expect(res.body.assignments.map((a: { choreId: string }) => a.choreId).sort()).toEqual(
      chores.map((c) => c.id).sort(),
    );
    for (const a of res.body.assignments) {
      expect(a).toMatchObject({
        weekKey: thisWeek,
        status: 'TODO',
        source: 'SHUFFLE',
        dueAt: weekRange(thisWeek).dueAt.toISOString(),
      });
      expect(users.map((u) => u.id)).toContain(a.assigneeUserId);
    }
    expect(emit).toHaveBeenCalledWith(houseId, 'chore:shuffled', { weekKey: thisWeek, relaxed: false });

    const got = await list(users[1].token, houseId).expect(200);
    expect(got.body.map((a: { id: string }) => a.id).sort()).toEqual(
      res.body.assignments.map((a: { id: string }) => a.id).sort(),
    );
  });

  it('Shuffle lại: giữ nguyên ca đã DONE, chỉ xếp lại các ca TODO', async () => {
    const { houseId, users } = await setup(['Hùng', 'Thiện'], [2, 3, 3]);
    const first = await shuffle(users[0].token, houseId).expect(201);
    const kept = first.body.assignments[0];
    await fx.prisma.choreAssignment.update({ where: { id: kept.id }, data: { status: 'DONE' } });

    const second = await shuffle(users[0].token, houseId).expect(201);
    expect(second.body.assignments).toHaveLength(3);
    const keptNow = second.body.assignments.find((a: { id: string }) => a.id === kept.id);
    expect(keptNow).toMatchObject({ status: 'DONE', assigneeId: kept.assigneeId, choreId: kept.choreId });
  });

  it('thành viên đã rời nhà không được xếp việc mới', async () => {
    const { houseId, users, memberId } = await setup(['Hùng', 'Thiện', 'Mai'], [1, 1, 1, 1]);
    await fx.prisma.houseMember.update({ where: { id: memberId(users[2]) }, data: { leftAt: new Date() } });
    const res = await shuffle(users[0].token, houseId).expect(201);
    const assignees = new Set(res.body.assignments.map((a: { assigneeUserId: string }) => a.assigneeUserId));
    expect(assignees.has(users[2].id)).toBe(false);
  });

  it('một thành viên, nhiều việc: tất cả về người đó', async () => {
    const { houseId, users } = await setup(['Hùng'], [1, 2, 3]);
    const res = await shuffle(users[0].token, houseId).expect(201);
    expect(res.body.assignments).toHaveLength(3);
    expect(new Set(res.body.assignments.map((a: { assigneeUserId: string }) => a.assigneeUserId))).toEqual(
      new Set([users[0].id]),
    );
  });

  it('vô nghiệm rào 3 tuần thì nới và trả relaxed: true', async () => {
    const { houseId, users, chores, memberId } = await setup(['Hùng'], [2]);
    // Người duy nhất đã làm đúng việc đó ở 2 tuần liền trước.
    for (const k of [1, 2]) {
      const weekKey = shiftWeek(thisWeek, -k);
      await fx.prisma.choreAssignment.create({
        data: {
          houseId,
          choreId: chores[0].id,
          assigneeId: memberId(users[0]),
          weekKey,
          dueAt: weekRange(weekKey).dueAt,
          source: 'AUTO',
          status: 'DONE',
        },
      });
    }
    const res = await shuffle(users[0].token, houseId).expect(201);
    expect(res.body.relaxed).toBe(true);
    expect(res.body.assignments).toHaveLength(1);
  });

  it('không cho xếp lại lịch của tuần đã qua', async () => {
    const { houseId, users } = await setup(['Hùng', 'Thiện'], [2]);
    await shuffle(users[0].token, houseId, { weekKey: shiftWeek(thisWeek, -1) }).expect(400);
  });

  it('generateWeek(AUTO) idempotent: gọi lần hai không tạo thêm', async () => {
    const { houseId } = await setup(['Hùng', 'Thiện'], [2, 3]);
    const svc = fx.app.get(ChoreScheduleService);
    const nextWeek = shiftWeek(thisWeek, 1);
    expect((await svc.generateWeek(houseId, nextWeek, 'AUTO')).created).toBe(2);
    const again = await svc.generateWeek(houseId, nextWeek, 'AUTO');
    expect(again.created).toBe(0);
    expect(again.assignments).toHaveLength(2);
  });
});

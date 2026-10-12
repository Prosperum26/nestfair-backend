import { vi } from 'vitest';
import { buildGenContext } from '../src/modules/chores/schedule-context.js';
import { ScheduleService } from '../src/modules/chores/schedule.service.js';
import { addDays, currentWeekStart, openAtOf, toDateStr } from '../src/modules/chores/week.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { dateOf, HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

describe('Absences, breaks & audit (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let svc: ScheduleService;
  const cur = currentWeekStart();
  const next = addDays(cur, 7);
  const monday = openAtOf(cur);

  beforeAll(async () => {
    fx = await createFixture('@e2e-absences.nestfair.test');
    svc = fx.app.get(ScheduleService);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  /** Nhà với một việc hằng ngày (PER_OCCURRENCE) nên mỗi người đều có ca trong tuần. */
  async function dailyHouse(names: string[]) {
    const h = await fx.houseWith(names);
    await fx.prisma.chore.create({
      data: { houseId: h.houseId, title: 'Rửa chén', weight: 2, frequency: 'DAILY', recurrenceDays: [1, 2, 3, 4, 5, 6, 7], rotationMode: 'PER_OCCURRENCE', dueTime: '21:00' },
    });
    return h;
  }
  const absences = (houseId: string, tail = '') => `/api/v1/houses/${houseId}/absences${tail}`;
  const breaks = (houseId: string, tail = '') => `/api/v1/houses/${houseId}/breaks${tail}`;
  const slots = (houseId: string, weekStart: string) => fx.prisma.choreAssignment.findMany({ where: { houseId, weekStart: dateOf(weekStart) }, orderBy: { occurrenceDate: 'asc' } });
  const tue = addDays(next, 1);
  const thu = addDays(next, 3);

  describe('vắng mặt', () => {
    it('S-20: slot TODO trong khoảng vắng còn ≥ 24h được dời cho người khác (REASSIGN), slot ngoài khoảng giữ nguyên', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện', 'Mai']);
      await svc.ensureSchedule(h.houseId, next, 'CRON', monday);
      const before = await slots(h.houseId, next);
      const inTuesdayToThursday = (s: (typeof before)[number]) => s.occurrenceDate >= dateOf(tue) && s.occurrenceDate <= dateOf(thu);
      // Chọn người thực sự có ca trong T3–T5 (phụ thuộc lần xáo ngẫu nhiên nên không giả định trước là ai).
      const idx = [0, 1, 2].reduce((best, i) =>
        before.filter((s) => s.assigneeId === h.memberId(h.users[i]) && inTuesdayToThursday(s)).length >
        before.filter((s) => s.assigneeId === h.memberId(h.users[best]) && inTuesdayToThursday(s)).length
          ? i
          : best,
      0);
      const absent = h.users[idx];
      const absentMember = h.memberId(absent);
      const inRange = before.filter((s) => s.assigneeId === absentMember && inTuesdayToThursday(s));
      const outside = before.filter((s) => s.assigneeId === absentMember && !inTuesdayToThursday(s));
      expect(inRange.length).toBeGreaterThan(0);

      const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');
      const res = await fx.as(absent.token).post(absences(h.houseId), { startDate: tue, endDate: thu, reason: 'Về quê' }).expect(201);
      expect(res.body).toMatchObject({ userId: absent.id, startDate: tue, endDate: thu, reason: 'Về quê' });

      const after = await slots(h.houseId, next);
      for (const s of inRange) {
        const now = after.find((x) => x.id === s.id)!;
        expect(now.assigneeId).not.toBe(absentMember);
        expect(now).toMatchObject({ source: 'REASSIGN', status: 'TODO', originalAssigneeId: absentMember });
      }
      for (const s of outside) expect(after.find((x) => x.id === s.id)!.assigneeId).toBe(absentMember);
      expect(emit).toHaveBeenCalledWith(h.houseId, 'chore:reassigned', expect.objectContaining({ assignmentIds: expect.any(Array) }));
    });

    it('slot còn < 24h không bị tự dời (phải dùng luồng đổi ca)', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện']);
      const soon = await makeAssignment(fx, h, { assignee: 1, occurrenceDate: toDateStr(new Date()), dueAt: new Date(Date.now() + 10 * HOUR) });
      const t = toDateStr(new Date());
      await fx.as(h.users[1].token).post(absences(h.houseId), { startDate: t, endDate: t }).expect(201);
      expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: soon.id } })).assigneeId).toBe(h.memberId(h.users[1]));
    });

    it('không còn ai nhận được slot ≥ 24h → UNASSIGNED để trưởng phòng giao tay', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện']);
      await svc.ensureSchedule(h.houseId, next, 'CRON', monday);
      // Cả hai cùng vắng thứ Ba tuần sau.
      await fx.as(h.users[0].token).post(absences(h.houseId), { startDate: tue, endDate: tue }).expect(201);
      await fx.as(h.users[1].token).post(absences(h.houseId), { startDate: tue, endDate: tue }).expect(201);
      const day = (await slots(h.houseId, next)).find((s) => s.occurrenceDate.getTime() === dateOf(tue).getTime())!;
      expect(day).toMatchObject({ status: 'UNASSIGNED', assigneeId: null });
    });

    it('S-21: vắng cả tuần → lịch tuần đó không có người ấy, lý do MEMBER_ABSENT', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện', 'Mai']);
      await fx.as(h.users[2].token).post(absences(h.houseId), { startDate: next, endDate: addDays(next, 6) }).expect(201);
      const { schedule } = await svc.ensureSchedule(h.houseId, next, 'CRON', monday);
      expect(schedule.reasons).toContain('MEMBER_ABSENT');
      expect(schedule.fenceWeeksApplied).toBe(2);
      expect((await slots(h.houseId, next)).some((s) => s.assigneeId === h.memberId(h.users[2]))).toBe(false);
    });

    it('validation: kết thúc trước bắt đầu, sai định dạng, ngày không tồn tại → 400', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện']);
      const post = (body: object) => fx.as(h.users[1].token).post(absences(h.houseId), body);
      await post({ startDate: tue, endDate: addDays(tue, -1) }).expect(400);
      await post({ startDate: '12/10/2026', endDate: '13/10/2026' }).expect(400);
      await post({ startDate: '2026-02-30', endDate: '2026-03-01' }).expect(400);
      await post({ startDate: tue }).expect(400);
      await post({ startDate: tue, endDate: tue, reason: 'x'.repeat(201) }).expect(400);
      await post({ startDate: tue, endDate: tue, nope: 1 }).expect(400);
    });

    it('quyền: thành viên khai cho chính mình; khai hộ người khác chỉ Admin; người ngoài nhà 403', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện', 'Mai']);
      await fx.as(h.users[1].token).post(absences(h.houseId), { userId: h.users[2].id, startDate: tue, endDate: tue }).expect(403);
      const forOther = await fx.as(h.users[0].token).post(absences(h.houseId), { userId: h.users[2].id, startDate: tue, endDate: tue }).expect(201);
      expect(forOther.body.userId).toBe(h.users[2].id);
      const stranger = await fx.user('Người lạ');
      await fx.as(h.users[0].token).post(absences(h.houseId), { userId: stranger.id, startDate: tue, endDate: tue }).expect(400);
      await fx.as(stranger.token).post(absences(h.houseId), { startDate: tue, endDate: tue }).expect(403);
      await fx.as(stranger.token).get(absences(h.houseId)).expect(403);
    });

    it('GET liệt kê kèm tên; DELETE: chính chủ hoặc Admin, người khác 403; có audit', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện', 'Mai']);
      const created = (await fx.as(h.users[1].token).post(absences(h.houseId), { startDate: tue, endDate: thu })).body;
      const list = await fx.as(h.users[2].token).get(absences(h.houseId)).expect(200);
      expect(list.body).toEqual([expect.objectContaining({ id: created.id, userName: expect.stringContaining('Thiện'), startDate: tue, endDate: thu })]);
      await fx.as(h.users[2].token).delete(absences(h.houseId, `/${created.id}`)).expect(403);
      await fx.as(h.users[1].token).delete(absences(h.houseId, `/${created.id}`)).expect(200);
      expect((await fx.as(h.users[0].token).get(absences(h.houseId)).expect(200)).body).toEqual([]);
      const logs = (await fx.prisma.choreAuditLog.findMany({ where: { houseId: h.houseId } })).map((l) => l.action);
      expect(logs).toEqual(expect.arrayContaining(['ABSENCE_CREATED', 'ABSENCE_DELETED']));
    });
  });

  describe('nghỉ cả nhà', () => {
    it('S-23: slot TODO trong khoảng nghỉ → CANCELLED (không MISSED), emit chore:cancelled; sinh lịch sau bỏ ngày nghỉ', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện']);
      await svc.ensureSchedule(h.houseId, next, 'CRON', monday);
      const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');
      await fx.as(h.users[0].token).post(breaks(h.houseId), { startDate: tue, endDate: thu, reason: 'Du lịch' }).expect(201);
      const after = await slots(h.houseId, next);
      for (const s of after) {
        const inBreak = s.occurrenceDate >= dateOf(tue) && s.occurrenceDate <= dateOf(thu);
        expect(s.status === 'CANCELLED').toBe(inBreak);
      }
      expect(emit).toHaveBeenCalledWith(h.houseId, 'chore:cancelled', expect.objectContaining({ assignmentIds: expect.any(Array) }));

      // Nhà khác: nghỉ trước, sinh lịch sau → không có slot trong ngày nghỉ.
      const g = await dailyHouse(['Mai', 'Quân']);
      await fx.as(g.users[0].token).post(breaks(g.houseId), { startDate: tue, endDate: thu }).expect(201);
      await svc.ensureSchedule(g.houseId, next, 'CRON', monday);
      const days = (await slots(g.houseId, next)).map((s) => s.occurrenceDate.toISOString().slice(0, 10));
      expect(days).not.toContain(tue);
      expect(days).not.toContain(addDays(next, 2));
      expect(days).toHaveLength(4);
    });

    it('cả tuần nghỉ → lịch EMPTY HOUSE_BREAK; tuần trống không tính vào cửa sổ rào (S-32)', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện', 'Mai']);
      await svc.ensureSchedule(h.houseId, cur, 'CRON', monday);
      await fx.as(h.users[0].token).post(breaks(h.houseId), { startDate: next, endDate: addDays(next, 6) }).expect(201);
      const { schedule } = await svc.ensureSchedule(h.houseId, next, 'CRON', monday);
      expect(schedule).toMatchObject({ status: 'EMPTY', reasons: ['HOUSE_BREAK'] });

      // Tuần sau tuần nghỉ: tuần có lịch gần nhất (tuần hiện tại) phải là "1 tuần trước", không phải "2 tuần trước".
      const ctx = await buildGenContext(fx.prisma, h.houseId, addDays(next, 7), 1);
      const weeksBack = new Set(ctx.input.history.map((x) => x.weeksBack));
      expect(weeksBack).toEqual(new Set([1]));
    });

    it('chỉ Admin; kết thúc trước bắt đầu → 400; GET + DELETE', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện']);
      await fx.as(h.users[1].token).post(breaks(h.houseId), { startDate: tue, endDate: thu }).expect(403);
      await fx.as(h.users[0].token).post(breaks(h.houseId), { startDate: thu, endDate: tue }).expect(400);
      const created = (await fx.as(h.users[0].token).post(breaks(h.houseId), { startDate: tue, endDate: thu, reason: 'Tết' }).expect(201)).body;
      expect((await fx.as(h.users[1].token).get(breaks(h.houseId)).expect(200)).body).toEqual([expect.objectContaining({ id: created.id, startDate: tue, endDate: thu, reason: 'Tết' })]);
      await fx.as(h.users[1].token).delete(breaks(h.houseId, `/${created.id}`)).expect(403);
      await fx.as(h.users[0].token).delete(breaks(h.houseId, `/${created.id}`)).expect(200);
      expect((await fx.as(h.users[1].token).get(breaks(h.houseId)).expect(200)).body).toEqual([]);
    });
  });

  describe('nhật ký thao tác', () => {
    it('GET /chore-audit: thành viên xem được, có tên người thao tác; lọc theo tuần; người ngoài 403; week sai 400', async () => {
      const h = await dailyHouse(['Hùng', 'Thiện']);
      await fx.as(h.users[0].token).post(breaks(h.houseId), { startDate: tue, endDate: tue, reason: 'Nghỉ' }).expect(201);
      const path = `/api/v1/houses/${h.houseId}/chore-audit`;
      const all = await fx.as(h.users[1].token).get(path).expect(200);
      expect(all.body).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'BREAK_CREATED', actorName: expect.stringContaining('Hùng') })]));
      const thisWeekKey = (await import('../src/modules/chores/week.js')).weekKeyFromStart(cur);
      expect((await fx.as(h.users[1].token).get(`${path}?week=${thisWeekKey}`).expect(200)).body.length).toBeGreaterThan(0);
      expect((await fx.as(h.users[1].token).get(`${path}?week=2020-W01`).expect(200)).body).toEqual([]);
      await fx.as(h.users[1].token).get(`${path}?week=abc`).expect(400);
      const stranger = await fx.user('Người lạ');
      await fx.as(stranger.token).get(path).expect(403);
    });
  });
});

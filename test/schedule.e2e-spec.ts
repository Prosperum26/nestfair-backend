import { HttpException } from '@nestjs/common';
import { ScheduleService } from '../src/modules/chores/schedule.service.js';
import { addDays, currentWeekStart, openAtOf, weekKeyFromStart } from '../src/modules/chores/week.js';
import { createFixture } from './support/house-fixture.js';

type Fx = Awaited<ReturnType<typeof createFixture>>;

describe('ScheduleService (e2e)', () => {
  let fx: Fx;
  let svc: ScheduleService;
  const cur = currentWeekStart();
  const next = addDays(cur, 7);
  // Đầu tuần hiện tại: mọi ca còn ở tương lai, kết quả không phụ thuộc giờ chạy test.
  const monday = openAtOf(cur);

  beforeAll(async () => {
    fx = await createFixture('@e2e-schedule.nestfair.test');
    svc = fx.app.get(ScheduleService);
  });
  afterAll(() => fx.cleanup());

  async function house(names: string[], chores: { title: string; weight?: number; days?: number[]; mode?: 'WEEK_BLOCK' | 'PER_OCCURRENCE' }[]) {
    const h = await fx.houseWith(names);
    for (const c of chores) {
      await fx.prisma.chore.create({
        data: {
          houseId: h.houseId,
          title: c.title,
          weight: c.weight ?? 2,
          frequency: (c.days?.length ?? 1) === 7 ? 'DAILY' : 'WEEKLY',
          recurrenceDays: c.days ?? [7],
          rotationMode: c.mode ?? 'WEEK_BLOCK',
          dueTime: '21:00',
        },
      });
    }
    return h;
  }
  const four = [{ title: 'A' }, { title: 'B', weight: 3 }, { title: 'C' }, { title: 'D', weight: 3 }];
  const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as HttpException;
  const count = (houseId: string, weekStart: string) =>
    fx.prisma.choreAssignment.count({ where: { houseId, weekStart: new Date(`${weekStart}T00:00:00Z`) } });

  it('T-08: 20 lần ensureSchedule song song cho cùng (nhà, tuần) chỉ tạo đúng 1 lịch và 1 bộ ca', async () => {
    const h = await house(['Hùng', 'Thiện', 'Mai', 'Quân'], four);
    const results = await Promise.all(Array.from({ length: 20 }, () => svc.ensureSchedule(h.houseId, cur, 'CRON')));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.schedule.id)).size).toBe(1);
    expect(await fx.prisma.weekSchedule.count({ where: { houseId: h.houseId } })).toBe(1);
    expect(await count(h.houseId, cur)).toBe(4);
  });

  it('T-10: tuần quá khứ hoặc cách hiện tại hơn 1 tuần → 422 WEEK_OUT_OF_RANGE', async () => {
    const h = await house(['Hùng', 'Thiện'], four);
    for (const ws of [addDays(cur, -7), addDays(cur, 14)]) {
      const e = await err(svc.ensureSchedule(h.houseId, ws, 'CRON'));
      expect(e.getStatus()).toBe(422);
      expect(e.getResponse()).toMatchObject({ code: 'WEEK_OUT_OF_RANGE' });
    }
    expect(await fx.prisma.weekSchedule.count({ where: { houseId: h.houseId } })).toBe(0);
  });

  it('T-09: cron lỡ → catchUpAll sinh bù (CATCHUP), chạy lại không tạo thêm', async () => {
    const h = await house(['Hùng', 'Thiện', 'Mai'], four);
    expect(await svc.catchUpAll(new Date(), [h.houseId])).toBe(1);
    const sched = await fx.prisma.weekSchedule.findFirstOrThrow({ where: { houseId: h.houseId } });
    expect(sched.generatedBy).toBe('CATCHUP');
    expect(await svc.catchUpAll(new Date(), [h.houseId])).toBe(0);
  });

  it('S-08: nhà chưa có việc → lịch EMPTY NO_CHORES; thêm việc rồi createSchedule thì sinh lại', async () => {
    const h = await house(['Hùng', 'Thiện'], []);
    const first = await svc.ensureSchedule(h.houseId, cur, 'CRON');
    expect(first.schedule).toMatchObject({ status: 'EMPTY', reasons: ['NO_CHORES'] });
    await fx.prisma.chore.create({ data: { houseId: h.houseId, title: 'X', weight: 2, recurrenceDays: [7], dueTime: '21:00' } });
    expect((await svc.ensureSchedule(h.houseId, cur, 'CRON')).schedule.id).toBe(first.schedule.id);
    const again = await svc.createSchedule(h.houseId, cur);
    expect(again.created).toBe(true);
    expect(again.schedule.status).not.toBe('EMPTY');
    expect(await count(h.houseId, cur)).toBe(1);
  });

  it('S-34: hai createSchedule đồng thời đều nhận cùng một lịch', async () => {
    const h = await house(['Hùng', 'Thiện'], four);
    const [a, b] = await Promise.all([svc.createSchedule(h.houseId, cur), svc.createSchedule(h.houseId, cur)]);
    expect(a.schedule.id).toBe(b.schedule.id);
    expect(await count(h.houseId, cur)).toBe(4);
  });

  it('lịch tạo cho tuần hiện tại lưu đủ trường: snapshot, hạn, weekKey, nguồn ROTATION, người gốc', async () => {
    const h = await house(['Hùng', 'Thiện'], [{ title: 'Đổ rác', weight: 2, days: [7] }]);
    await svc.ensureSchedule(h.houseId, cur, 'CRON');
    const row = await fx.prisma.choreAssignment.findFirstOrThrow({ where: { houseId: h.houseId } });
    expect(row).toMatchObject({
      weekKey: weekKeyFromStart(cur),
      titleSnapshot: 'Đổ rác',
      weightSnapshot: 2,
      source: 'ROTATION',
      status: 'TODO',
      slotIndex: 0,
    });
    expect(row.assigneeId).toBe(row.originalAssigneeId);
    expect(row.dueAt.toISOString()).toBe(new Date(`${addDays(cur, 6)}T14:00:00.000Z`).toISOString());
  });

  describe('re-roll (T-17)', () => {
    it('Admin re-roll lịch tuần sau: đổi lịch, rerollCount tăng, ghi audit; thành viên thường bị 403', async () => {
      const h = await house(['Hùng', 'Thiện', 'Mai', 'Quân'], four);
      await svc.ensureSchedule(h.houseId, next, 'CRON', monday);
      const admin = { memberId: h.memberId(h.users[0]), role: 'ADMIN' as const };
      const member = { memberId: h.memberId(h.users[1]), role: 'ROOMMATE' as const };

      const denied = await err(svc.rerollSchedule(h.houseId, next, member, monday));
      expect(denied.getStatus()).toBe(403);

      const res = await svc.rerollSchedule(h.houseId, next, admin, monday);
      expect(res.changed).toBe(true);
      expect(res.schedule).toMatchObject({ rerollCount: 1, generatedBy: 'ADMIN_REROLL' });
      expect(await fx.prisma.choreAuditLog.count({ where: { houseId: h.houseId, action: 'REROLL' } })).toBe(1);
      expect(await count(h.houseId, next)).toBe(4);
    });

    it('quá 2 lần → 409 REROLL_LIMIT', async () => {
      const h = await house(['Hùng', 'Thiện', 'Mai', 'Quân'], four);
      await svc.ensureSchedule(h.houseId, next, 'CRON', monday);
      const admin = { memberId: h.memberId(h.users[0]), role: 'ADMIN' as const };
      await svc.rerollSchedule(h.houseId, next, admin, monday);
      await svc.rerollSchedule(h.houseId, next, admin, monday);
      const e = await err(svc.rerollSchedule(h.houseId, next, admin, monday));
      expect(e.getStatus()).toBe(409);
      expect(e.getResponse()).toMatchObject({ code: 'REROLL_LIMIT' });
    });

    it('đã có ca nộp/duyệt → 409 SCHEDULE_HAS_ACTIVITY', async () => {
      const h = await house(['Hùng', 'Thiện', 'Mai', 'Quân'], four);
      await svc.ensureSchedule(h.houseId, next, 'CRON', monday);
      const one = await fx.prisma.choreAssignment.findFirstOrThrow({ where: { houseId: h.houseId } });
      await fx.prisma.choreAssignment.update({ where: { id: one.id }, data: { status: 'PENDING_VERIFY' } });
      const e = await err(svc.rerollSchedule(h.houseId, next, { memberId: h.memberId(h.users[0]), role: 'ADMIN' }, monday));
      expect(e.getStatus()).toBe(409);
      expect(e.getResponse()).toMatchObject({ code: 'SCHEDULE_HAS_ACTIVITY' });
    });

    it('tuần đã bắt đầu thì khóa → 409 SCHEDULE_LOCKED', async () => {
      const h = await house(['Hùng', 'Thiện', 'Mai', 'Quân'], four);
      await svc.ensureSchedule(h.houseId, cur, 'CRON', monday);
      const e = await err(svc.rerollSchedule(h.houseId, cur, { memberId: h.memberId(h.users[0]), role: 'ADMIN' }, new Date(openAtOf(cur).getTime() + 3_600_000)));
      expect(e.getStatus()).toBe(409);
      expect(e.getResponse()).toMatchObject({ code: 'SCHEDULE_LOCKED' });
    });

    it('chỉ có một phương án hợp lệ → changed:false, không tăng rerollCount', async () => {
      const h = await house(['Hùng'], [{ title: 'Duy nhất', days: [7] }]);
      await svc.ensureSchedule(h.houseId, next, 'CRON', monday);
      const res = await svc.rerollSchedule(h.houseId, next, { memberId: h.memberId(h.users[0]), role: 'ADMIN' }, monday);
      expect(res.changed).toBe(false);
      expect(res.message).toBe('Không có phương án khác thỏa rào công bằng');
      expect(res.schedule.rerollCount).toBe(0);
    });
  });

  describe('thành viên rời nhà (T-19)', () => {
    it('ca TODO tương lai của người đã rời được giao lại, giữ originalAssigneeId, không còn ca mồ côi', async () => {
      const h = await house(['Hùng', 'Thiện', 'Mai'], four);
      await svc.ensureSchedule(h.houseId, cur, 'CRON', monday);
      const leaver = h.memberId(h.users[1]);
      const before = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId, assigneeId: leaver } });
      expect(before.length).toBeGreaterThan(0);
      await fx.prisma.houseMember.update({ where: { id: leaver }, data: { leftAt: new Date() } });

      const res = await svc.reassignOrphans(h.houseId, monday);
      expect(res.moved).toBe(before.length);
      const after = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId } });
      expect(after.some((a) => a.assigneeId === leaver)).toBe(false);
      for (const b of before) {
        const row = after.find((a) => a.id === b.id)!;
        expect(row).toMatchObject({ source: 'REASSIGN', status: 'TODO', originalAssigneeId: leaver });
      }
    });

    it('không còn ai nhận được (vắng đúng ngày) → UNASSIGNED', async () => {
      const h = await house(['Hùng', 'Thiện'], [{ title: 'X', days: [7] }]);
      await svc.ensureSchedule(h.houseId, cur, 'CRON', monday);
      const row = await fx.prisma.choreAssignment.findFirstOrThrow({ where: { houseId: h.houseId } });
      const leaverIdx = row.assigneeId === h.memberId(h.users[0]) ? 0 : 1;
      const stayer = h.users[1 - leaverIdx];
      await fx.prisma.houseMember.update({ where: { id: h.memberId(h.users[leaverIdx]) }, data: { leftAt: new Date() } });
      const day = addDays(cur, 6);
      await fx.prisma.memberAbsence.create({
        data: { houseId: h.houseId, userId: stayer.id, startDate: new Date(`${day}T00:00:00Z`), endDate: new Date(`${day}T00:00:00Z`), createdById: stayer.id },
      });
      const res = await svc.reassignOrphans(h.houseId, monday);
      expect(res).toMatchObject({ moved: 0, unassigned: 1 });
      expect(await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'UNASSIGNED', assigneeId: null });
    });
  });

  it('S-31: sinh liên tiếp qua tuần 53 (2026-W53 → 2027-W01), đúng ngày và weekKey', async () => {
    const h = await house(['Hùng', 'Thiện', 'Mai'], [{ title: 'Thứ Hai', days: [1] }, { title: 'Chủ Nhật', days: [7] }]);
    const w52 = '2026-12-21';
    // now nằm trong tuần cần sinh hoặc ngay tuần trước đó.
    await svc.ensureSchedule(h.houseId, w52, 'CRON', new Date('2026-12-22T05:00:00Z'));
    await svc.ensureSchedule(h.houseId, '2026-12-28', 'CRON', new Date('2026-12-27T14:00:00Z'));
    await svc.ensureSchedule(h.houseId, '2027-01-04', 'CRON', new Date('2027-01-03T14:00:00Z'));
    const rows = await fx.prisma.choreAssignment.findMany({ where: { houseId: h.houseId }, orderBy: { occurrenceDate: 'asc' } });
    expect(rows.map((r) => `${r.weekKey}@${r.occurrenceDate.toISOString().slice(0, 10)}`)).toEqual([
      '2026-W52@2026-12-21',
      '2026-W52@2026-12-27',
      '2026-W53@2026-12-28',
      '2026-W53@2027-01-03',
      '2027-W01@2027-01-04',
      '2027-W01@2027-01-10',
    ]);
  });

  it('preview không ghi DB và trả seed + lý do', async () => {
    const h = await house(['Hùng', 'Thiện'], four);
    const p = await svc.previewSchedule(h.houseId, cur);
    expect(typeof p.seed).toBe('number');
    expect(p.slots).toHaveLength(4);
    expect(Array.isArray(p.reasons)).toBe(true);
    expect(await fx.prisma.weekSchedule.count({ where: { houseId: h.houseId } })).toBe(0);
    expect(await count(h.houseId, cur)).toBe(0);
  });
});

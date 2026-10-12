import { vi } from 'vitest';
import { addDays, currentWeekStart, toDateStr } from '../src/modules/chores/week.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { ChoreCronService } from '../src/modules/scheduler/chore-cron.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { assignmentIn, dateOf, HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

describe('Chore cron (e2e)', () => {
  const destroy = vi.fn();
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let cron: ChoreCronService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-cron.nestfair.test', (b) => b.overrideProvider(CloudinaryService).useValue({ upload: vi.fn(), destroy }));
    cron = fx.app.get(ChoreCronService);
  });
  beforeEach(() => destroy.mockReset());
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const status = async (id: string) => (await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id } })).status;
  const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

  describe('markMissed (T-15)', () => {
    it('chỉ TODO và REJECTED quá hạn + ân hạn (3 giờ) thành MISSED; chạy lại không lỗi', async () => {
      const h = await assignmentIn(fx, ['Hùng', 'Thiện'], { dueAt: ago(4) });
      const mk = (over: Parameters<typeof makeAssignment>[2]) => makeAssignment(fx, h, over);
      const rejected = await mk({ status: 'REJECTED', dueAt: ago(4) });
      const withinGrace = await mk({ dueAt: ago(1) });
      const pending = await mk({ status: 'PENDING_VERIFY', dueAt: ago(10) });
      const done = await mk({ status: 'DONE', dueAt: ago(10) });
      const cancelled = await mk({ status: 'CANCELLED', dueAt: ago(10) });
      const future = await mk({ dueAt: new Date(Date.now() + HOUR) });

      expect(await cron.markMissed(new Date(), [h.houseId])).toBe(2);
      expect(await status(h.assignment.id)).toBe('MISSED');
      expect(await status(rejected.id)).toBe('MISSED');
      for (const a of [withinGrace, pending, done, cancelled, future]) expect(await status(a.id)).not.toBe('MISSED');
      expect(await status(pending.id)).toBe('PENDING_VERIFY');
      expect(await cron.markMissed(new Date(), [h.houseId])).toBe(0);
    });

    it('ân hạn theo cài đặt của từng nhà', async () => {
      const a = await assignmentIn(fx, ['Hùng', 'Thiện'], { dueAt: ago(2) });
      const b = await assignmentIn(fx, ['Mai', 'Quân'], { dueAt: ago(2) });
      await fx.prisma.house.update({ where: { id: b.houseId }, data: { choreGraceHours: 1 } });
      await cron.markMissed(new Date(), [a.houseId, b.houseId]);
      expect(await status(a.assignment.id)).toBe('TODO');
      expect(await status(b.assignment.id)).toBe('MISSED');
    });

    it('phát chore:missed cho nhà có ca bị đánh dấu', async () => {
      const h = await assignmentIn(fx, ['Hùng', 'Thiện'], { dueAt: ago(5) });
      const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');
      await cron.markMissed(new Date(), [h.houseId]);
      expect(emit).toHaveBeenCalledWith(h.houseId, 'chore:missed', expect.objectContaining({ assignmentIds: [h.assignment.id] }));
    });

    it('S-54: check-in đúng lúc cron chạy → chỉ một bên thắng, không ai ghi đè', async () => {
      const h = await assignmentIn(fx, ['Hùng', 'Thiện'], { dueAt: ago(4) });
      const [missed, submitted] = await Promise.all([
        cron.markMissed(new Date(), [h.houseId]),
        fx.prisma.choreAssignment.updateMany({ where: { id: h.assignment.id, status: 'TODO' }, data: { status: 'PENDING_VERIFY' } }),
      ]);
      const final = await status(h.assignment.id);
      expect(final === 'MISSED' ? missed === 1 && submitted.count === 0 : missed === 0 && submitted.count === 1).toBe(true);
    });

    it('S-44: 3 ca MISSED liên tiếp của một người → ghi audit MISSED_STREAK và báo Admin (một lần)', async () => {
      const h = await assignmentIn(fx, ['Hùng', 'Thiện'], { occurrenceDate: addDays(toDateStr(new Date()), -4), dueAt: ago(96) });
      await makeAssignment(fx, h, { occurrenceDate: addDays(toDateStr(new Date()), -3), dueAt: ago(72) });
      await makeAssignment(fx, h, { occurrenceDate: addDays(toDateStr(new Date()), -2), dueAt: ago(48) });
      const emitUser = vi.spyOn(fx.app.get(EventsService), 'emitToUser');
      await cron.markMissed(new Date(), [h.houseId]);
      const logs = await fx.prisma.choreAuditLog.findMany({ where: { houseId: h.houseId, action: 'MISSED_STREAK' } });
      expect(logs).toHaveLength(1);
      expect(emitUser).toHaveBeenCalledWith(h.users[0].id, 'chore:missed', expect.objectContaining({ streak: 3 }));
      await cron.markMissed(new Date(), [h.houseId]);
      expect(await fx.prisma.choreAuditLog.count({ where: { houseId: h.houseId, action: 'MISSED_STREAK' } })).toBe(1);
    });
  });

  describe('autoApprove (T-16)', () => {
    it('PENDING_VERIFY quá 48h → DONE AUTO_APPROVED; chưa tới 48h giữ nguyên; chạy lại không lỗi', async () => {
      const h = await assignmentIn(fx, ['Hùng', 'Thiện'], { status: 'PENDING_VERIFY', submittedAt: ago(49) });
      const fresh = await makeAssignment(fx, h, { status: 'PENDING_VERIFY', submittedAt: ago(47) });
      const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');
      expect(await cron.autoApprove(new Date(), [h.houseId])).toBe(1);
      const approved = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: h.assignment.id } });
      expect(approved).toMatchObject({ status: 'DONE', verifyMode: 'AUTO_APPROVED', verifiedById: null });
      expect(approved.verifiedAt).toBeTruthy();
      expect(await status(fresh.id)).toBe('PENDING_VERIFY');
      expect(emit).toHaveBeenCalledWith(h.houseId, 'chore:verified', expect.objectContaining({ assignmentId: h.assignment.id, verifyMode: 'AUTO_APPROVED', status: 'DONE' }));
      expect(await cron.autoApprove(new Date(), [h.houseId])).toBe(0);
    });
  });

  describe('cleanupProofs', () => {
    it('xóa ảnh của ca DONE quá 60 ngày (giữ bản ghi), idempotent', async () => {
      const url = 'https://res.cloudinary.com/demo/image/upload/v1/nestfair/houses/h/proofs/old.png';
      const h = await assignmentIn(fx, ['Hùng', 'Thiện'], { status: 'DONE', proofImageUrl: url, submittedAt: ago(61 * 24) });
      const recent = await makeAssignment(fx, h, { status: 'DONE', proofImageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/nestfair/x/new.png', submittedAt: ago(10 * 24) });
      expect(await cron.cleanupProofs(new Date(), [h.houseId])).toBe(1);
      expect(destroy).toHaveBeenCalledWith('nestfair/houses/h/proofs/old');
      const old = await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: h.assignment.id } });
      expect(old).toMatchObject({ status: 'DONE', proofImageUrl: null });
      expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: recent.id } })).proofImageUrl).toBeTruthy();
      destroy.mockClear();
      expect(await cron.cleanupProofs(new Date(), [h.houseId])).toBe(0);
      expect(destroy).not.toHaveBeenCalled();
    });
  });

  describe('sinh lịch & khóa tuần', () => {
    it('S-33: hai lần generateNextWeek chạy song song vẫn chỉ ra 1 lịch / nhà; S-08: nhà chưa có việc không lỗi', async () => {
      const withChore = await assignmentIn(fx, ['Hùng', 'Thiện']);
      const empty = await fx.houseWith(['Mai', 'Quân']);
      const ids = [withChore.houseId, empty.houseId];
      const [a, b] = await Promise.all([cron.generateNextWeek(new Date(), ids), cron.generateNextWeek(new Date(), ids)]);
      expect(a.houses + b.houses).toBe(4);
      expect(a.created + b.created).toBe(2);
      const next = dateOf(addDays(currentWeekStart(), 7));
      expect(await fx.prisma.weekSchedule.count({ where: { houseId: { in: ids }, weekStart: next } })).toBe(2);
      const emptySched = await fx.prisma.weekSchedule.findFirstOrThrow({ where: { houseId: empty.houseId, weekStart: next } });
      expect(emptySched).toMatchObject({ status: 'EMPTY', generatedBy: 'CRON' });
    });

    it('lockStartedWeeks: PUBLISHED của tuần đã bắt đầu → LOCKED; tuần sau giữ nguyên', async () => {
      const h = await fx.houseWith(['Hùng', 'Thiện']);
      const mk = (ws: string, weekKey: string) =>
        fx.prisma.weekSchedule.create({
          data: { houseId: h.houseId, weekStart: dateOf(ws), weekKey, status: 'PUBLISHED', generatedBy: 'CRON', seed: 1, attempts: 0, fenceWeeksApplied: 2, reasons: [], loadSnapshot: {}, algoVersion: 'v2' },
        });
      const cur = await mk(currentWeekStart(), 'cur');
      const next = await mk(addDays(currentWeekStart(), 7), 'next');
      expect(await cron.lockStartedWeeks(new Date(), [h.houseId])).toBe(1);
      expect((await fx.prisma.weekSchedule.findUniqueOrThrow({ where: { id: cur.id } })).status).toBe('LOCKED');
      expect((await fx.prisma.weekSchedule.findUniqueOrThrow({ where: { id: next.id } })).status).toBe('PUBLISHED');
    });
  });
});

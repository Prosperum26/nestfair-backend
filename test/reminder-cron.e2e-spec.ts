import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { dueAtOf, toDateStr } from '../src/modules/chores/week.js';
import { EventsService } from '../src/modules/events/events.service.js';
import {
  ChoreTodayDigestSource,
  type DigestSource,
  DIGEST_SOURCES,
  ReminderCronService,
} from '../src/modules/scheduler/reminder-cron.service.js';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

const MINUTE = 60_000;

/**
 * Cron nhắc nhở (Issue #12, thẻ BE-5): gọi trực tiếp dispatchDue(now) / sendDailyDigest(now, houseIds),
 * spy EventsService.emitToUser. Provider DIGEST_SOURCES bị override "thêm" nguồn giả (nguồn ca trực
 * thật vẫn đứng đầu mảng) để kiểm chứng cách nối dòng nhiều nguồn.
 */
describe('Reminder cron (e2e)', () => {
  const fakeLines = vi.fn(async (_userId: string, _houseId: string, _day: string): Promise<string[]> => []);
  const fakeSource: DigestSource = { linesFor: (userId, houseId, day) => fakeLines(userId, houseId, day) };
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let cron: ReminderCronService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-reminder-cron.nestfair.test', (b) =>
      b.overrideProvider(DIGEST_SOURCES).useFactory({
        factory: (choreToday: DigestSource) => [choreToday, fakeSource],
        inject: [ChoreTodayDigestSource],
      }),
    );
    cron = fx.app.get(ReminderCronService);
  });
  beforeEach(() => {
    fakeLines.mockReset();
    fakeLines.mockResolvedValue([]); // mặc định nguồn giả không thêm dòng gì
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const spy = () => vi.spyOn(fx.app.get(EventsService), 'emitToUser');
  /** Số lần socket bắn reminder:due cho đúng reminderId này. */
  const emitsFor = (emit: ReturnType<typeof spy>, reminderId: string): number =>
    emit.mock.calls.filter(([, , payload]) => (payload as { reminderId: string }).reminderId === reminderId).length;

  const seedReminder = (data: {
    userId: string;
    houseId: string;
    title: string;
    remindAt: Date;
    source?: 'USER' | 'SYSTEM';
    sentAt?: Date;
  }) => fx.prisma.reminder.create({ data: { ...data, source: data.source ?? 'USER' } });

  describe('dispatchDue (quét mỗi phút)', () => {
    it('(1) nhắc đến hạn → sentAt được đặt, đúng MỘT reminder:due tới đúng user với { reminderId, title }, tin SYSTEM vào thread mới nhất', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const oldThread = randomUUID();
      const latestThread = randomUUID();
      const base = Date.now() - 30 * MINUTE;
      await fx.prisma.assistantMessage.createMany({
        data: [
          { houseId, userId: users[0].id, threadId: oldThread, role: 'USER', content: 'Tin cũ', createdAt: new Date(base) },
          { houseId, userId: users[0].id, threadId: latestThread, role: 'USER', content: 'Tin mới', createdAt: new Date(base + MINUTE) },
        ],
      });
      const due = await seedReminder({ userId: users[0].id, houseId, title: 'Đổ rác tối nay', remindAt: new Date(Date.now() - 5 * MINUTE) });

      const emit = spy();
      const now = new Date();
      const res = await cron.dispatchDue(now, [houseId]);
      expect(res.sent).toBe(1);

      const row = await fx.prisma.reminder.findUniqueOrThrow({ where: { id: due.id } });
      expect(row.sentAt?.toISOString()).toBe(now.toISOString());
      expect(emit).toHaveBeenCalledWith(users[0].id, 'reminder:due', { reminderId: due.id, title: 'Đổ rác tối nay' });
      expect(emitsFor(emit, due.id)).toBe(1);

      const sys = await fx.prisma.assistantMessage.findMany({ where: { houseId, userId: users[0].id, role: 'SYSTEM' } });
      expect(sys).toHaveLength(1);
      expect(sys[0]).toMatchObject({ threadId: latestThread, content: 'Đổ rác tối nay' });
    });

    it('(2) chạy lần hai với cùng now → không bắn lại, không thêm tin', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const due = await seedReminder({ userId: users[0].id, houseId, title: 'Đóng tiền nước', remindAt: new Date(Date.now() - MINUTE) });

      const emit = spy();
      await cron.dispatchDue(new Date(), [houseId]);
      expect(emitsFor(emit, due.id)).toBe(1);
      const second = await cron.dispatchDue(new Date(), [houseId]);
      expect(second.sent).toBe(0);
      expect(emitsFor(emit, due.id)).toBe(1);
      expect(await fx.prisma.assistantMessage.count({ where: { houseId, role: 'SYSTEM' } })).toBe(1);
    });

    it('(3) hai lần gọi song song trên nhiều nhắc đến hạn → mỗi nhắc chỉ được gửi đúng một lần (SKIP LOCKED)', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await seedReminder({
          userId: users[i % 2].id,
          houseId,
          title: 'Nhắc ' + i,
          remindAt: new Date(Date.now() - (5 - i) * MINUTE),
        });
        ids.push(r.id);
      }

      const emit = spy();
      const now = new Date();
      const [a, b] = await Promise.all([cron.dispatchDue(now, [houseId]), cron.dispatchDue(now, [houseId])]);
      expect(a.sent + b.sent).toBe(5);
      for (const id of ids) expect(emitsFor(emit, id)).toBe(1);
      const rows = await fx.prisma.reminder.findMany({ where: { id: { in: ids } } });
      expect(rows.every((r) => r.sentAt !== null)).toBe(true);
      expect(await fx.prisma.assistantMessage.count({ where: { houseId, role: 'SYSTEM' } })).toBe(5);
    });

    it('(3b) có houseIds → chỉ gửi nhắc của các nhà đó, nhắc đến hạn của nhà khác giữ nguyên', async () => {
      const a = await fx.houseWith(['Hùng', 'Thiện']);
      const b = await fx.houseWith(['Mai', 'Quân']);
      const mine = await seedReminder({ userId: a.users[0].id, houseId: a.houseId, title: 'Nhà A', remindAt: new Date(Date.now() - MINUTE) });
      const other = await seedReminder({ userId: b.users[0].id, houseId: b.houseId, title: 'Nhà B', remindAt: new Date(Date.now() - MINUTE) });

      const res = await cron.dispatchDue(new Date(), [a.houseId]);
      expect(res.sent).toBe(1);
      expect((await fx.prisma.reminder.findUniqueOrThrow({ where: { id: mine.id } })).sentAt).not.toBeNull();
      expect((await fx.prisma.reminder.findUniqueOrThrow({ where: { id: other.id } })).sentAt).toBeNull();
    });

    it('(4) nhắc chưa đến hạn / đã gửi (sentAt != null) → không bị chạm', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const past = new Date(Date.now() - HOUR);
      const future = await seedReminder({ userId: users[0].id, houseId, title: 'Tương lai', remindAt: new Date(Date.now() + HOUR) });
      const sent = await seedReminder({ userId: users[0].id, houseId, title: 'Đã gửi', remindAt: past, sentAt: past });

      const emit = spy();
      const res = await cron.dispatchDue(new Date(), [houseId]);
      expect(res.sent).toBe(0);
      expect(emitsFor(emit, future.id)).toBe(0);
      expect(emitsFor(emit, sent.id)).toBe(0);
      expect(await fx.prisma.reminder.findUniqueOrThrow({ where: { id: future.id } })).toMatchObject({ sentAt: null });
      expect((await fx.prisma.reminder.findUniqueOrThrow({ where: { id: sent.id } })).sentAt?.toISOString()).toBe(past.toISOString());
    });
  });

  describe('sendDailyDigest (08:00 hằng ngày giờ VN)', () => {
    it('(5) 2 ca TODO hôm nay → 1 Reminder SYSTEM dedupeKey digest:<ngày>, title đúng mẫu, tin SYSTEM + reminder:due; chạy hai lần chỉ một nhắc', async () => {
      const house = await fx.houseWith(['Hùng', 'Thiện']);
      const today = toDateStr(new Date());
      await makeAssignment(fx, house, { assignee: 0, occurrenceDate: today, dueAt: dueAtOf(today, '18:00') }, { title: 'Đổ rác' });
      await makeAssignment(fx, house, { assignee: 0, occurrenceDate: today, dueAt: dueAtOf(today, '21:00') }, { title: 'Rửa chén' });

      const emit = spy();
      const now = new Date();
      const first = await cron.sendDailyDigest(now, [house.houseId]);
      expect(first.created).toBe(1); // Thiện không có ca hôm nay → không nhận

      const rows = await fx.prisma.reminder.findMany({ where: { houseId: house.houseId } });
      expect(rows).toHaveLength(1);
      const expectedTitle = 'Hôm nay bạn có 2 ca: Đổ rác (đến 18:00), Rửa chén (đến 21:00)';
      expect(rows[0]).toMatchObject({ userId: house.users[0].id, source: 'SYSTEM', dedupeKey: 'digest:' + today, title: expectedTitle });
      expect(rows[0].remindAt.toISOString()).toBe(dueAtOf(today, '08:00').toISOString()); // 08:00 hôm nay giờ VN
      expect(rows[0].sentAt?.toISOString()).toBe(now.toISOString());
      expect(emit).toHaveBeenCalledWith(house.users[0].id, 'reminder:due', { reminderId: rows[0].id, title: expectedTitle });

      const sys = await fx.prisma.assistantMessage.findMany({ where: { houseId: house.houseId, role: 'SYSTEM' } });
      expect(sys).toHaveLength(1);
      expect(sys[0]).toMatchObject({ userId: house.users[0].id, content: expectedTitle });

      const second = await cron.sendDailyDigest(now, [house.houseId]);
      expect(second.created).toBe(0);
      expect(await fx.prisma.reminder.count({ where: { houseId: house.houseId } })).toBe(1);
      expect(await fx.prisma.assistantMessage.count({ where: { houseId: house.houseId, role: 'SYSTEM' } })).toBe(1);
      expect(emitsFor(emit, rows[0].id)).toBe(1);
    });

    it('(6) ca DONE / ca của người khác không tính; không có ca TODO hôm nay → không tạo gì', async () => {
      const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const today = toDateStr(new Date());
      await makeAssignment(fx, house, { assignee: 0, occurrenceDate: today, dueAt: dueAtOf(today, '20:00'), status: 'DONE' }, { title: 'Đã xong' });
      await makeAssignment(fx, house, { assignee: 1, occurrenceDate: today, dueAt: dueAtOf(today, '19:00') }, { title: 'Lau sàn' });

      const emit = spy();
      const res = await cron.sendDailyDigest(new Date(), [house.houseId]);
      expect(res.created).toBe(1); // chỉ Thiện với ca TODO của chính mình
      const rows = await fx.prisma.reminder.findMany({ where: { houseId: house.houseId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: house.users[1].id, title: 'Hôm nay bạn có 1 ca: Lau sàn (đến 19:00)' });
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(house.users[1].id, 'reminder:due', { reminderId: rows[0].id, title: 'Hôm nay bạn có 1 ca: Lau sàn (đến 19:00)' });
      // Hùng (chỉ có ca DONE) và Mai (không có ca) không nhận gì.
      expect(await fx.prisma.assistantMessage.count({ where: { userId: house.users[0].id, role: 'SYSTEM' } })).toBe(0);
      expect(await fx.prisma.assistantMessage.count({ where: { userId: house.users[2].id, role: 'SYSTEM' } })).toBe(0);
    });

    it('(7) người đã rời nhà (leftAt != null) không nhận digest', async () => {
      const house = await fx.houseWith(['Hùng', 'Thiện']);
      const today = toDateStr(new Date());
      await makeAssignment(fx, house, { assignee: 1, occurrenceDate: today, dueAt: dueAtOf(today, '19:00') }, { title: 'Lau sàn' });
      await fx.prisma.houseMember.update({ where: { id: house.memberId(house.users[1]) }, data: { leftAt: new Date() } });

      const emit = spy();
      const res = await cron.sendDailyDigest(new Date(), [house.houseId]);
      expect(res.created).toBe(0);
      expect(await fx.prisma.reminder.count({ where: { houseId: house.houseId } })).toBe(0);
      expect(await fx.prisma.assistantMessage.count({ where: { houseId: house.houseId, role: 'SYSTEM' } })).toBe(0);
      expect(emit).not.toHaveBeenCalled();
    });

    it('(8) biên giờ VN: 07:59 và 08:00 cùng ngày VN chỉ tạo một; occurrenceDate tính theo ngày VN, không theo UTC', async () => {
      // Phần A: 07:59 và 08:00 giờ VN cùng ngày 16-06-2026 → cùng dedupeKey digest:2026-06-16.
      const partA = await fx.houseWith(['Hùng']);
      await makeAssignment(fx, partA, { assignee: 0, occurrenceDate: '2026-06-16', dueAt: dueAtOf('2026-06-16', '19:00') }, { title: 'Lau sàn' });
      const at0759 = new Date('2026-06-16T00:59:00Z'); // 07:59 giờ VN
      const at0800 = new Date('2026-06-16T01:00:00Z'); // 08:00 giờ VN
      expect((await cron.sendDailyDigest(at0759, [partA.houseId])).created).toBe(1);
      expect((await cron.sendDailyDigest(at0800, [partA.houseId])).created).toBe(0);
      const rowsA = await fx.prisma.reminder.findMany({ where: { houseId: partA.houseId } });
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0].dedupeKey).toBe('digest:2026-06-16');
      expect(rowsA[0].remindAt.toISOString()).toBe('2026-06-16T01:00:00.000Z'); // đúng 08:00 giờ VN

      // Phần B: now = 18:30 UTC ngày 15-06 = 01:30 ngày 16-06 giờ VN → "hôm nay" là 16-06 (ngày VN),
      // ca ngày 15-06 (đúng ngày UTC của now) không được tính.
      const partB = await fx.houseWith(['Thiện', 'Mai']);
      await makeAssignment(fx, partB, { assignee: 0, occurrenceDate: '2026-06-16', dueAt: dueAtOf('2026-06-16', '19:00') }, { title: 'Ca ngày VN' });
      await makeAssignment(fx, partB, { assignee: 1, occurrenceDate: '2026-06-15', dueAt: dueAtOf('2026-06-15', '20:00') }, { title: 'Ca ngày UTC' });
      const res = await cron.sendDailyDigest(new Date('2026-06-15T18:30:00Z'), [partB.houseId]);
      expect(res.created).toBe(1);
      const rowsB = await fx.prisma.reminder.findMany({ where: { houseId: partB.houseId } });
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0]).toMatchObject({ userId: partB.users[0].id, title: 'Hôm nay bạn có 1 ca: Ca ngày VN (đến 19:00)' });
    });

    it('(9) DigestSource giả (nguồn thứ hai của DIGEST_SOURCES) được nối thành dòng riêng trong title', async () => {
      const house = await fx.houseWith(['Hùng', 'Thiện']);
      const today = toDateStr(new Date());
      await makeAssignment(fx, house, { assignee: 0, occurrenceDate: today, dueAt: dueAtOf(today, '18:00') }, { title: 'Đổ rác' });
      fakeLines.mockImplementation(async (userId: string) => (userId === house.users[0].id ? ['Bạn có 1 yêu cầu đổi ca chờ duyệt'] : []));

      const res = await cron.sendDailyDigest(new Date(), [house.houseId]);
      expect(res.created).toBe(1);
      const row = await fx.prisma.reminder.findFirstOrThrow({ where: { houseId: house.houseId } });
      expect(row.title).toBe('Hôm nay bạn có 1 ca: Đổ rác (đến 18:00)\nBạn có 1 yêu cầu đổi ca chờ duyệt');
      expect(fakeLines).toHaveBeenCalledWith(house.users[0].id, house.houseId, today);
    });
  });
});

/**
 * Dữ liệu demo theo Design.md mục 7: Nhà 12A, 4 người (Hùng trưởng phòng).
 * Chạy lại bao nhiêu lần cũng được (upsert). Các module sau (chores, expenses…)
 * bổ sung dữ liệu của mình vào cuối file, dùng lại `users` và `house` ở dưới.
 *
 *   npm run seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { generateWeek } from '../src/modules/chores/algorithms/schedule-generator.js';
import { buildGenContext } from '../src/modules/chores/schedule-context.js';
import { createScheduleRows } from '../src/modules/chores/schedule-store.js';
import { addDays, currentWeekStart, toDateStr, weekKeyFromStart, weekStartOf } from '../src/modules/chores/week.js';
import { buildSlices } from '../src/modules/wheel/algorithms/wheel.js';
import { seedListing } from './seed-listing.js';

const PASSWORD = 'NestFair123';
const INVITE_CODE = 'K7M2QZ';

// BIN Napas: Techcombank 970407, Vietcombank 970436, ACB 970416, MB 970422.
const MEMBERS = [
  {
    key: 'hung',
    fullName: 'Trần Minh Hùng',
    phone: '0901234567',
    bankBin: '970407',
    bankAccount: '19036780123',
    role: 'ADMIN',
  },
  {
    key: 'thien',
    fullName: 'Lê Đức Thiện',
    phone: '0912345678',
    bankBin: '970436',
    bankAccount: '0071000444456',
    role: 'ROOMMATE',
  },
  {
    key: 'mai',
    fullName: 'Phạm Ngọc Mai',
    phone: '0923456789',
    bankBin: '970416',
    bankAccount: '24617789',
    role: 'ROOMMATE',
  },
  {
    key: 'quan',
    fullName: 'Nguyễn Minh Quân',
    phone: '0934567890',
    bankBin: '970422',
    bankAccount: '0801234566789',
    role: 'ROOMMATE',
  },
] as const;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const CHORES = [
  { title: 'Rửa chén buổi tối', weight: 2, frequency: 'DAILY', recurrenceDays: [1, 2, 3, 4, 5, 6, 7], dueTime: '21:00', rotationMode: 'PER_OCCURRENCE' },
  { title: 'Đổ rác', weight: 2, frequency: 'WEEKLY', recurrenceDays: [1, 4], dueTime: '21:00', rotationMode: 'WEEK_BLOCK' },
  { title: 'Lau bếp', weight: 2, frequency: 'WEEKLY', recurrenceDays: [1], dueTime: '20:00', rotationMode: 'WEEK_BLOCK' },
  { title: 'Tưới cây ban công', weight: 1, frequency: 'WEEKLY', recurrenceDays: [2, 5], dueTime: '18:00', rotationMode: 'WEEK_BLOCK' },
  { title: 'Lau nhà', weight: 3, frequency: 'WEEKLY', recurrenceDays: [6], dueTime: '18:00', rotationMode: 'WEEK_BLOCK' },
  { title: 'Dọn nhà tắm', weight: 3, frequency: 'WEEKLY', recurrenceDays: [7], dueTime: '18:00', rotationMode: 'WEEK_BLOCK' },
] as const;

const SAMPLE_PROOF_URL = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';

/**
 * Hai khoản chi tháng 10 có nguồn từ OCR hóa đơn (đặc tả: seed có 2 khoản chi từ OCR). Mỗi khoản có một
 * ReceiptScan đã dùng, draftJson là JSON Gemini trả về; tổng các món bằng đúng tổng khoản chi nên không đổi số dư.
 */
const OCR_DRAFTS: Record<string, { merchant: string; items: { name: string; quantity: number; lineTotal: number }[] }> = {
  'Đi chợ cuối tuần': {
    merchant: 'Bách Hóa Xanh',
    items: [
      { name: 'Rau củ', quantity: 1, lineTotal: 180_000 },
      { name: 'Thịt cá', quantity: 1, lineTotal: 240_000 },
      { name: 'Trái cây', quantity: 1, lineTotal: 100_000 },
    ],
  },
  'Nước rửa chén & giấy': {
    merchant: 'Co.opmart',
    items: [
      { name: 'Nước rửa chén', quantity: 1, lineTotal: 45_000 },
      { name: 'Giấy vệ sinh', quantity: 1, lineTotal: 75_000 },
    ],
  },
};

/**
 * Việc nhà theo Design.md mục 7: 6 việc, 4 người. Dùng chính thuật toán sinh lịch (seed cố định) cho
 * 3 tuần lịch sử (đã xong, có 1 ca MISSED), tuần này (có ca chờ duyệt, bị từ chối và bỏ ca để demo) và tuần sau
 * (đã công bố, chưa bắt đầu, còn xáo lại được). Xóa và tạo lại dữ liệu việc nhà của nhà demo mỗi lần chạy.
 */
async function seedChores(houseId: string, users: Record<string, { id: string }>) {
  const memberIds: string[] = [];
  for (const { key } of MEMBERS) {
    const m = await prisma.houseMember.findFirstOrThrow({ where: { houseId, userId: users[key].id, leftAt: null }, select: { id: true } });
    memberIds.push(m.id);
  }
  const [hung, thien, mai, quan] = memberIds;

  await prisma.choreAuditLog.deleteMany({ where: { houseId } });
  await prisma.memberAbsence.deleteMany({ where: { houseId } });
  await prisma.houseBreak.deleteMany({ where: { houseId } });
  await prisma.choreAssignment.deleteMany({ where: { houseId } });
  await prisma.weekSchedule.deleteMany({ where: { houseId } });
  await prisma.chore.deleteMany({ where: { houseId } });
  for (const c of CHORES) await prisma.chore.create({ data: { houseId, ...c, recurrenceDays: [...c.recurrenceDays] } });

  const today = toDateStr(new Date());
  const thisWeek = currentWeekStart();
  const verifierOf = (assigneeId: string) => memberIds[(memberIds.indexOf(assigneeId) + 1) % memberIds.length];

  for (const offset of [-3, -2, -1, 0, 1]) {
    const weekStart = addDays(thisWeek, offset * 7);
    const seed = 4200 + offset;
    const ctx = await buildGenContext(prisma, houseId, weekStart, seed);
    const res = generateWeek(ctx.input);
    const schedule = await createScheduleRows(prisma, houseId, weekStart, 'CRON', seed, ctx, res, offset <= 0 ? 'LOCKED' : 'PUBLISHED');
    if (offset >= 1) continue;

    const rows = await prisma.choreAssignment.findMany({ where: { scheduleId: schedule.id }, orderBy: [{ occurrenceDate: 'asc' }, { dueAt: 'asc' }] });
    const done = (a: (typeof rows)[number]) =>
      prisma.choreAssignment.update({
        where: { id: a.id },
        data: {
          status: 'DONE',
          proofImageUrl: SAMPLE_PROOF_URL,
          proofHash: `seed-${a.id}`,
          submittedAt: new Date(a.dueAt.getTime() - 3_600_000),
          verifiedById: verifierOf(a.assigneeId!),
          verifiedAt: new Date(a.dueAt.getTime() - 1_800_000),
          verifyMode: 'PEER',
        },
      });

    // Ca "demo" của tuần này: lấy ca sớm nhất của từng người.
    const firstOf = (memberId: string) => rows.find((r) => r.assigneeId === memberId);
    const demo = new Map<string, 'PENDING_VERIFY' | 'REJECTED' | 'MISSED'>();
    if (offset === 0) {
      for (const [m, st] of [[thien, 'PENDING_VERIFY'], [mai, 'REJECTED'], [quan, 'MISSED']] as const) {
        const r = firstOf(m);
        if (r) demo.set(r.id, st);
      }
    } else if (offset === -1) {
      const r = firstOf(quan);
      if (r) demo.set(r.id, 'MISSED');
    }

    for (const a of rows) {
      const special = demo.get(a.id);
      if (special === 'MISSED') await prisma.choreAssignment.update({ where: { id: a.id }, data: { status: 'MISSED' } });
      else if (special === 'PENDING_VERIFY') {
        await prisma.choreAssignment.update({
          where: { id: a.id },
          data: { status: 'PENDING_VERIFY', proofImageUrl: SAMPLE_PROOF_URL, proofHash: `seed-${a.id}`, submittedAt: new Date() },
        });
      } else if (special === 'REJECTED') {
        await prisma.choreAssignment.update({
          where: { id: a.id },
          data: {
            status: 'REJECTED',
            proofImageUrl: SAMPLE_PROOF_URL,
            proofHash: `seed-${a.id}`,
            submittedAt: new Date(),
            rejectReason: 'Ảnh bị mờ, chưa thấy sàn đã lau',
            rejectCount: 1,
            verifiedById: verifierOf(a.assigneeId!),
            verifiedAt: new Date(),
            verifyMode: 'PEER',
          },
        });
      } else if (offset < 0 || toDateStr(a.occurrenceDate) < today) await done(a);
    }
  }
  void hung;
}

/**
 * Issue #5: việc hệ thống "Việc đột xuất", 1 vòng quay đã công bố (Thiện quay, Quân trúng, Thiện không tham gia)
 * kèm ca WHEEL còn TODO, và vài mục Live Ticker. Ghi thẳng bảng (seed không đi qua ActivityService, không phát sự kiện).
 */
async function seedRealtime(houseId: string, users: Record<string, { id: string; fullName: string }>) {
  await prisma.houseActivity.deleteMany({ where: { houseId } });
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);
  const memberOf = (key: string) =>
    prisma.houseMember.findFirstOrThrow({ where: { houseId, userId: users[key].id, leftAt: null }, select: { id: true } });

  // Vòng quay đã công bố 40 phút trước.
  const system = await prisma.chore.create({
    data: { houseId, title: 'Việc đột xuất', frequency: 'ADHOC', recurrenceDays: [], weight: 1, isSystem: true },
  });
  const today = toDateStr(new Date());
  const weekStart = weekStartOf(today);
  const quan = await memberOf('quan');
  const participantIds = [users.hung.id, users.mai.id, users.quan.id];
  const seed = 771204;
  const slices = buildSlices(participantIds, seed);
  const landingIndex = slices.indexOf(users.quan.id);
  const taskTitle = 'Mua nước bình 20L';
  const slot = await prisma.choreAssignment.create({
    data: {
      houseId,
      choreId: system.id,
      assigneeId: quan.id,
      originalAssigneeId: quan.id,
      weekKey: weekKeyFromStart(weekStart),
      weekStart: new Date(`${weekStart}T00:00:00Z`),
      occurrenceDate: new Date(`${today}T00:00:00Z`),
      slotIndex: 0,
      dueAt: new Date(now + 3 * 3_600_000),
      titleSnapshot: taskTitle,
      weightSnapshot: 1,
      source: 'WHEEL',
      status: 'TODO',
    },
  });
  const spunAt = at(40);
  await prisma.luckyWheelLog.create({
    data: {
      houseId,
      spunById: users.thien.id,
      taskTitle,
      dueAt: slot.dueAt,
      participantIds,
      excludedCount: 1,
      slices,
      selectedUserId: users.quan.id,
      assignmentId: slot.id,
      seed,
      landingIndex,
      status: 'REVEALED',
      spunAt,
      durationMs: 6000,
      revealAt: new Date(spunAt.getTime() + 6000),
    },
  });

  // Live Ticker: lấy các ca demo của tuần này để câu chữ khớp dữ liệu.
  const demo = (status: 'PENDING_VERIFY' | 'REJECTED' | 'MISSED') =>
    prisma.choreAssignment.findFirst({ where: { houseId, status, source: { not: 'WHEEL' } }, orderBy: { dueAt: 'desc' } });
  const [pending, rejected, missed] = await Promise.all([demo('PENDING_VERIFY'), demo('REJECTED'), demo('MISSED')]);
  const actor = (key: string) => ({ actorUserId: users[key].id, actorName: users[key].fullName });
  const rows = [
    { ...actor('hung'), type: 'schedule.generated', params: { weekKey: weekKeyFromStart(weekStart), relaxed: false }, createdAt: at(60 * 30) },
    missed && { ...actor('quan'), type: 'chore.missed', params: { count: 1, choreTitle: missed.titleSnapshot, choreTitles: [missed.titleSnapshot] }, createdAt: at(180) },
    rejected && {
      ...actor('hung'),
      type: 'chore.rejected',
      params: { assignmentId: rejected.id, choreTitle: rejected.titleSnapshot, targetUserId: users.mai.id, targetName: users.mai.fullName },
      createdAt: at(95),
    },
    pending && { ...actor('thien'), type: 'chore.submitted', params: { assignmentId: pending.id, choreTitle: pending.titleSnapshot, selfAttested: false }, createdAt: at(70) },
    {
      ...actor('thien'),
      type: 'wheel.result',
      params: {
        taskTitle,
        participantIds,
        participantNames: [users.hung.fullName, users.mai.fullName, users.quan.fullName],
        excludedCount: 1,
        winnerUserId: users.quan.id,
        winnerName: users.quan.fullName,
      },
      createdAt: new Date(spunAt.getTime() + 6000),
    },
  ].filter((r): r is NonNullable<typeof r> => !!r);
  await prisma.houseActivity.createMany({ data: rows.map((r) => ({ houseId, ...r })) });
  return rows.length;
}

/** Xóa dữ liệu đổi ca của nhà demo (khóa trước, vì `swap_locks` không có khóa ngoại tới ca). */
async function cleanSwaps(houseId: string) {
  const swapIds = (await prisma.choreSwapRequest.findMany({ where: { houseId }, select: { id: true } })).map((s) => s.id);
  await prisma.swapLock.deleteMany({ where: { swapRequestId: { in: swapIds } } });
  await prisma.choreSwapRequest.deleteMany({ where: { houseId } });
  await prisma.choreDebt.deleteMany({ where: { houseId } });
  await prisma.rotationSwap.deleteMany({ where: { houseId } });
}

/**
 * Issue #7 (đặc tả mục 13.2): Chợ ca kèm quà đang chờ, nợ ca đã tới cửa sổ chọn bù, nợ ca chờ ca gốc xong,
 * chuỗi yêu cầu đã hết hạn chờ leo thang (có một lần ADD_REWARD), hai slot WHEEL "Thông bồn cầu" cùng ngày,
 * và một EXCHANGE Hùng ↔ Thiện đang chờ. Dựa vào lịch tuần sau (đã công bố) và tuần này do `seedChores` tạo.
 * Ghi thẳng bảng, không phát sự kiện. Ca MISSED và PENDING_VERIFY đã có sẵn từ `seedChores`.
 */
async function seedSwaps(houseId: string, users: Record<string, { id: string; fullName: string }>) {
  const now = Date.now();
  const HOUR = 3_600_000;
  const memberOf = async (key: string) =>
    (await prisma.houseMember.findFirstOrThrow({ where: { houseId, userId: users[key].id, leftAt: null }, select: { id: true } })).id;
  const [hung, thien, mai, quan] = await Promise.all([memberOf('hung'), memberOf('thien'), memberOf('mai'), memberOf('quan')]);

  // Ca còn TODO, hạn còn xa (≥ 25 giờ) để mọi quy tắc "còn kịp" đều thỏa. Ưu tiên tuần sau (đã công bố, cả tuần ở tương lai).
  const thisWeek = currentWeekStart();
  const futureTodo = await prisma.choreAssignment.findMany({
    where: {
      houseId,
      status: 'TODO',
      source: { not: 'WHEEL' },
      assigneeId: { not: null },
      dueAt: { gte: new Date(now + 25 * HOUR) },
      weekStart: { in: [new Date(`${addDays(thisWeek, 7)}T00:00:00Z`), new Date(`${thisWeek}T00:00:00Z`)] },
    },
    orderBy: [{ weekStart: 'desc' }, { dueAt: 'asc' }],
  });
  const used = new Set<string>();
  const take = (memberId: string, sameWeekAs?: Date) => {
    const found = futureTodo.find((a) => a.assigneeId === memberId && !used.has(a.id) && (!sameWeekAs || a.weekStart.getTime() === sameWeekAs.getTime()));
    if (!found) throw new Error('Seed đổi ca: không đủ ca TODO ở tương lai cho thành viên demo.');
    used.add(found.id);
    return found;
  };
  const lock = (assignmentId: string, swapRequestId: string) => prisma.swapLock.create({ data: { assignmentId, swapRequestId } });
  const ids = () => crypto.randomUUID();

  // 1. Chợ ca kèm quà 30.000đ đang chờ (a7): Quân đăng.
  const a7 = take(quan);
  const marketId = ids();
  await prisma.choreSwapRequest.create({
    data: {
      id: marketId,
      houseId,
      type: 'COVER',
      requesterMemberId: quan,
      fromAssignmentId: a7.id,
      compensation: 'GIFT',
      rewardNote: 'Bao 1 ly trà sữa',
      rewardAmount: 30000,
      reason: 'Tối đó mình có hẹn',
      expiresAt: new Date(Math.min(now + 20 * HOUR, a7.dueAt.getTime() - 6 * HOUR)),
      rootRequestId: marketId,
      fromWeightSnapshot: a7.weightSnapshot,
      fromVersion: a7.version,
    },
  });
  await lock(a7.id, marketId);

  // 2. Nợ ca OPEN đã tới cửa sổ chọn bù: Mai nợ Quân. Ca gốc (Quân làm hộ Mai) đã DONE.
  const past = await prisma.choreAssignment.findFirst({
    where: { houseId, assigneeId: quan, status: 'DONE', source: { not: 'WHEEL' } },
    orderBy: { dueAt: 'desc' },
  });
  if (past) {
    await prisma.choreAssignment.update({ where: { id: past.id }, data: { source: 'COVER', originalAssigneeId: mai } });
    await prisma.choreDebt.create({
      data: {
        houseId,
        debtorMemberId: mai,
        creditorMemberId: quan,
        swapRequestId: ids(),
        coverAssignmentId: past.id,
        weight: past.weightSnapshot,
        pickOpensAt: new Date(now - 2 * HOUR),
        pickDeadlineAt: new Date(now + 46 * HOUR),
      },
    });
  }

  // 3. Nợ ca OPEN chờ ca gốc DONE: Hùng nợ Thiện. Ca gốc (Thiện đang làm hộ Hùng) còn TODO.
  const covering = take(thien);
  await prisma.choreAssignment.update({ where: { id: covering.id }, data: { source: 'COVER', originalAssigneeId: hung } });
  await prisma.choreDebt.create({
    data: { houseId, debtorMemberId: hung, creditorMemberId: thien, swapRequestId: ids(), coverAssignmentId: covering.id, weight: covering.weightSnapshot },
  });

  // 4. Chuỗi hết hạn chờ leo thang: Mai đăng Chợ ca, hết hạn, thêm quà đăng lại, lại hết hạn. Còn đến dueAt − 1h để chọn.
  const mine = take(mai);
  const rootId = ids();
  const secondId = ids();
  const expired = (id: string, amount: number, extra: object) => ({
    id,
    houseId,
    type: 'COVER' as const,
    requesterMemberId: mai,
    fromAssignmentId: mine.id,
    compensation: 'GIFT' as const,
    rewardAmount: amount,
    status: 'EXPIRED' as const,
    expiresAt: new Date(now - HOUR),
    closedAt: new Date(now - HOUR),
    rootRequestId: rootId,
    escalationDeadline: new Date(mine.dueAt.getTime() - HOUR),
    fromWeightSnapshot: mine.weightSnapshot,
    fromVersion: mine.version,
    ...extra,
  });
  await prisma.choreSwapRequest.create({
    data: expired(rootId, 20000, { resolution: 'ESCALATED', escalationChoice: 'ADD_REWARD', rewardNote: 'Bao ly cà phê', createIdemKey: `seed-${rootId}` }),
  });
  await prisma.choreSwapRequest.create({
    data: expired(secondId, 40000, { resolution: 'EXPIRED_NO_TAKER', rewardNote: 'Bao ly cà phê và bánh', createIdemKey: `seed-${secondId}` }),
  });

  // 5. Hai slot WHEEL "Thông bồn cầu" cùng việc, cùng ngày (a9 của Quân, a10 của Hùng), dưới việc hệ thống của vòng quay.
  const system = await prisma.chore.findFirstOrThrow({ where: { houseId, isSystem: true }, select: { id: true } });
  const day = addDays(toDateStr(new Date(now)), 2);
  for (const [slotIndex, assignee] of [[0, quan], [1, hung]] as const) {
    await prisma.choreAssignment.create({
      data: {
        houseId,
        choreId: system.id,
        assigneeId: assignee,
        originalAssigneeId: assignee,
        weekKey: weekKeyFromStart(weekStartOf(day)),
        weekStart: new Date(`${weekStartOf(day)}T00:00:00Z`),
        occurrenceDate: new Date(`${day}T00:00:00Z`),
        slotIndex,
        dueAt: new Date(now + 48 * HOUR),
        titleSnapshot: 'Thông bồn cầu',
        weightSnapshot: 1,
        source: 'WHEEL',
        status: 'TODO',
      },
    });
  }

  // 6. EXCHANGE đang chờ để demo khóa "Đang chờ đổi": Hùng ↔ Thiện, cùng tuần.
  const hungSlot = take(hung);
  const thienSlot = take(thien, hungSlot.weekStart);
  const exId = ids();
  await prisma.choreSwapRequest.create({
    data: {
      id: exId,
      houseId,
      type: 'EXCHANGE',
      requesterMemberId: hung,
      targetMemberId: thien,
      fromAssignmentId: hungSlot.id,
      toAssignmentId: thienSlot.id,
      note: 'Thiện đổi giúp mình nhé',
      expiresAt: new Date(Math.min(now + 20 * HOUR, hungSlot.dueAt.getTime() - HOUR, thienSlot.dueAt.getTime() - HOUR)),
      rootRequestId: exId,
      fromWeightSnapshot: hungSlot.weightSnapshot,
      toWeightSnapshot: thienSlot.weightSnapshot,
      fromVersion: hungSlot.version,
      toVersion: thienSlot.version,
    },
  });
  await lock(hungSlot.id, exId);
  await lock(thienSlot.id, exId);
}

/** Giờ trưa (giờ nhà, UTC+7) của một ngày: tránh lệch ngày khi hiển thị theo múi giờ. */
const at = (ymd: string) => new Date(`${ymd}T12:00:00+07:00`);

/** Ngày hôm nay (giờ VN) dạng YYYY-MM-DD. */
const vnToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

/** Ngày của thứ kế tiếp trong tuần (1 = Thứ Hai…7 = Chủ Nhật) theo lịch VN, luôn ở tương lai. */
const vnNextWeekday = (isoWeekday: number) => {
  const base = new Date(`${vnToday()}T00:00:00+07:00`);
  for (let add = 1; add <= 7; add += 1) {
    // Mốc 00:00+07:00 cộng 7 giờ là 00:00 UTC cùng ngày lịch VN, đọc an toàn qua getUTC*.
    const vn = new Date(base.getTime() + (add * 86_400_000 + 7 * 3_600_000));
    const dow = vn.getUTCDay() === 0 ? 7 : vn.getUTCDay();
    if (dow === isoWeekday) return vn.toISOString().slice(0, 10);
  }
  throw new Error('Không tìm thấy thứ trong tuần kế tiếp');
};

/**
 * Sổ chi theo Design.md mục 7: tháng 10 tổng 2.280.000đ (6 hóa đơn, ảnh 07), tháng 9 đã tất toán hết
 * bằng 3 settlement CONFIRMED, và 1 settlement PENDING (Thiện báo đã chuyển cho Mai, ảnh 09).
 * Số dư ròng sau seed: Mai +380.000đ, Quân +170.000đ, Hùng −170.000đ, Thiện −380.000đ, nên rút gọn còn
 * Thiện → Mai 380.000đ và Hùng → Quân 170.000đ. Xóa và tạo lại sổ chi của nhà demo mỗi lần chạy.
 */
async function seedExpenses(houseId: string, users: Record<string, { id: string }>) {
  const id = (key: string) => users[key].id;
  const all = MEMBERS.map((m) => m.key);
  const equal = (total: number, keys: readonly string[] = all) => {
    const base = Math.floor(total / keys.length);
    const extra = total - base * keys.length;
    return keys.map((k, i) => ({ k, amount: base + (i < extra ? 1 : 0) }));
  };
  const exact = (amounts: Record<string, number>) => Object.entries(amounts).map(([k, amount]) => ({ k, amount }));

  await prisma.settlement.deleteMany({ where: { houseId } });
  // Xóa scan trước: khóa ngoại expenseId là SetNull nên scan cũ sẽ mồ côi nếu để lại khi chạy seed lần hai.
  await prisma.receiptScan.deleteMany({ where: { houseId } });
  await prisma.expense.deleteMany({ where: { houseId } });

  const expenses = [
    // Tháng 10 (khớp ảnh 07).
    { title: 'Nước rửa chén & giấy', category: 'SUPPLIES', payer: 'mai', date: '2026-10-05', splitType: 'EQUAL', splits: equal(120_000) },
    { title: 'Bình gas', category: 'OTHER', payer: 'hung', date: '2026-10-05', splitType: 'EQUAL', splits: equal(380_000) },
    {
      title: 'Đi chợ cuối tuần',
      category: 'FOOD',
      payer: 'quan',
      date: '2026-10-04',
      splitType: 'EXACT',
      splits: exact({ hung: 110_000, thien: 120_000, mai: 140_000, quan: 150_000 }),
      receiptImageUrl: SAMPLE_PROOF_URL,
    },
    { title: 'Wifi tháng 10', category: 'INTERNET', payer: 'quan', date: '2026-10-03', splitType: 'EQUAL', splits: equal(240_000) },
    { title: 'Tiền nước', category: 'WATER', payer: 'thien', date: '2026-10-02', splitType: 'EQUAL', splits: equal(180_000) },
    { title: 'Tiền điện tháng 10', category: 'ELECTRICITY', payer: 'mai', date: '2026-10-01', splitType: 'EQUAL', splits: equal(840_000) },
    // Tháng 9: đã tất toán hết bằng 3 settlement CONFIRMED bên dưới.
    {
      title: 'Tiền điện tháng 9',
      category: 'ELECTRICITY',
      payer: 'mai',
      date: '2026-09-27',
      splitType: 'EXACT',
      splits: exact({ hung: 100_000, thien: 95_000, mai: 190_000, quan: 15_000 }),
    },
    {
      title: 'Wifi tháng 9',
      category: 'INTERNET',
      payer: 'quan',
      date: '2026-09-26',
      splitType: 'CUSTOM',
      splits: equal(100_000, ['hung', 'quan']),
    },
  ] as const;

  for (const e of expenses) {
    const totalAmount = e.splits.reduce((sum, s) => sum + s.amount, 0);
    const ocr = OCR_DRAFTS[e.title];
    const created = await prisma.expense.create({
      data: {
        houseId,
        payerId: id(e.payer),
        createdById: id(e.payer),
        title: e.title,
        category: e.category,
        totalAmount,
        splitType: e.splitType,
        spentAt: at(e.date),
        receiptImageUrl: 'receiptImageUrl' in e ? e.receiptImageUrl : null,
        // Khoản từ OCR giữ danh sách món để xem lại (chia kiểu khác nên userIds rỗng).
        items: ocr ? ocr.items.map((i) => ({ name: i.name, lineTotal: i.lineTotal, userIds: [] })) : undefined,
        splits: { create: e.splits.map((s) => ({ userId: id(s.k), allocatedAmount: s.amount })) },
      },
    });
    if (ocr) {
      await prisma.receiptScan.create({
        data: {
          houseId,
          scannedById: id(e.payer),
          imageUrl: 'receiptImageUrl' in e ? e.receiptImageUrl : SAMPLE_PROOF_URL,
          status: 'USED',
          draftJson: { ...ocr, purchasedAt: e.date, total: totalAmount, warnings: [] },
          model: 'seed',
          latencyMs: 2100,
          expenseId: created.id,
        },
      });
    }
  }

  const settlements = [
    { from: 'quan', to: 'hung', amount: 60_000, status: 'CONFIRMED', date: '2026-09-28' },
    { from: 'thien', to: 'quan', amount: 95_000, status: 'CONFIRMED', date: '2026-09-29', proofUrl: SAMPLE_PROOF_URL },
    { from: 'hung', to: 'mai', amount: 210_000, status: 'CONFIRMED', date: '2026-09-30' },
    { from: 'thien', to: 'mai', amount: 380_000, status: 'PENDING', date: '2026-10-06', proofUrl: SAMPLE_PROOF_URL },
  ] as const;

  for (const s of settlements) {
    const createdAt = at(s.date);
    await prisma.settlement.create({
      data: {
        houseId,
        fromUserId: id(s.from),
        toUserId: id(s.to),
        amount: s.amount,
        status: s.status,
        proofUrl: 'proofUrl' in s ? s.proofUrl : null,
        createdAt,
        confirmedAt: s.status === 'CONFIRMED' ? createdAt : null,
      },
    });
  }
}

/**
 * Chat Trợ lý + nhắc nhở demo cho Hùng (màn 19): thread "WC có mùi" với trả lời có 3 nút hành
 * động (nút tạo nhắc đã bấm nên nhắc ASSISTANT 20:00 hôm nay xuất hiện ở panel với chip
 * "Từ trợ lý"), 1 nhắc USER thứ Sáu và 1 nhắc SYSTEM thứ Bảy (chỉ sửa được, D12). Xóa dữ liệu
 * chat + nhắc của nhà demo trước khi tạo nên chạy lại được.
 */
async function seedAssistantReminders(houseId: string, users: Record<string, { id: string }>) {
  const hung = users.hung.id;

  await prisma.assistantMessage.deleteMany({ where: { houseId } });
  await prisma.reminder.deleteMany({ where: { houseId } });

  const threadId = crypto.randomUUID();
  const today = vnToday();
  const minutes = (iso: string, hhmm: string) => new Date(`${iso}T${hhmm}:00+07:00`);

  await prisma.assistantMessage.create({
    data: {
      userId: hung,
      houseId,
      threadId,
      role: 'USER',
      content: 'WC phòng mình có mùi hôi quá, xử lý sao?',
      createdAt: minutes(today, '19:02'),
    },
  });

  const actions = [
    {
      type: 'CREATE_ADHOC_TASK',
      label: 'Việc đột xuất: Cọ WC (vòng quay)',
      payload: { title: 'Cọ WC (vòng quay)' },
    },
    {
      type: 'DRAFT_EXPENSE',
      label: 'Ghi khoản mua: Viên tây bồn cầu ~35.000đ',
      payload: { title: 'Viên tây bồn cầu', estimatedAmount: 35_000 },
    },
    {
      type: 'CREATE_REMINDER',
      label: 'Nhắc mình tối nay 20:00',
      payload: { title: 'Thả viên tây bồn cầu, dễ qua đêm', remindAt: `${today}T20:00:00+07:00` },
    },
  ];
  const assistantReply = await prisma.assistantMessage.create({
    data: {
      userId: hung,
      houseId,
      threadId,
      role: 'ASSISTANT',
      content:
        'Mùi WC thường do ống thoát sàn bị khô hoặc cặn trong bồn cầu. Thử theo thứ tự:\n' +
        '1. Đổ 1 ca nước vào ống thoát sàn để tạo nút nước chắn mùi.\n' +
        '2. Thả viên tẩy bồn cầu, để qua đêm rồi cọ lại.\n' +
        '3. Bật quạt hút 15 phút sau khi tắm.\n' +
        'Sau 2 ngày vẫn còn mùi thì nên báo chủ trọ kiểm tra ống thông hơi.',
      category: 'INCIDENT',
      actionsJson: actions,
      createdAt: new Date(minutes(today, '19:02').getTime() + 30_000),
    },
  });

  await prisma.assistantMessage.create({
    data: {
      userId: hung,
      houseId,
      threadId,
      role: 'USER',
      content: 'Nói sao để bạn bớt ồn sau 11h mà không mất lòng?',
      createdAt: minutes(today, '19:10'),
    },
  });

  await prisma.assistantMessage.create({
    data: {
      userId: hung,
      houseId,
      threadId,
      role: 'ASSISTANT',
      content:
        'Nội quy nhà điều 1 ghi "giữ yên lặng sau 23:00", nên bạn có thể nhắc nhẹ dựa vào đó. Ví dụ: ' +
        '"Tuần này mình thi, sau 11h mọi người đeo tai nghe giúp mình nha, cảm ơn nhiều!" ' +
        'Nói trực tiếp kịp lúc hài hước sẽ dễ nghe hơn nhắn trong nhóm.',
      category: 'EMOTIONAL',
      createdAt: new Date(minutes(today, '19:10').getTime() + 40_000),
    },
  });

  // 3 nhắc của Hùng ở panel (ảnh 19). Nhắc ASSISTANT gắn dedupeKey đúng nút thứ 3 của tin trả
  // lời nên nút đó trong chat hiện trạng thái "đã bấm". SYSTEM chỉ sửa được, không xóa (D12).
  await prisma.reminder.create({
    data: {
      userId: hung,
      houseId,
      title: 'Thả viên tây bồn cầu, dễ qua đêm',
      remindAt: minutes(today, '20:00'),
      source: 'ASSISTANT',
      dedupeKey: `msg:${assistantReply.id}:2`,
    },
  });
  await prisma.reminder.create({
    data: {
      userId: hung,
      houseId,
      title: 'Đóng tiền nhà cho chủ trọ',
      remindAt: minutes(vnNextWeekday(5), '19:00'),
      source: 'USER',
    },
  });
  await prisma.reminder.create({
    data: {
      userId: hung,
      houseId,
      title: 'Nhắc ca rửa chén buổi tối của bạn',
      remindAt: minutes(vnNextWeekday(6), '08:00'),
      source: 'SYSTEM',
    },
  });

  // Hùng đã đồng ý gửi chat cho Gemini (D5) nên demo chat được ngay, không dừng ở hộp thoại.
  await prisma.user.update({
    where: { id: hung },
    data: { assistantConsentAt: new Date() },
  });
}

async function main() {
  const started = Date.now();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const users = Object.fromEntries(
    await Promise.all(
      MEMBERS.map(async ({ key, fullName, phone, bankBin, bankAccount }) => {
        const email = `${key}@nestfair.demo`;
        const profile = { fullName, phone, bankBin, bankAccount };
        const user = await prisma.user.upsert({
          where: { email },
          update: { ...profile, passwordHash },
          create: { email, ...profile, passwordHash },
        });
        return [key, user] as const;
      }),
    ),
  );

  const houseData = {
    name: 'Nhà 12A',
    address: 'Hẻm 51, Linh Trung, Thủ Đức',
    // 4 người như thiết kế, chừa 1 chỗ để demo luồng vào nhà bằng mã.
    maxMembers: 5,
    inviteExpiresAt: new Date(Date.now() + 7 * 86_400_000),
    rules:
      'Đổ rác trước 21:00. Khách ở qua đêm báo trước trong nhóm. Tiền điện nước chia đều, chốt ngày 05 hằng tháng.',
  };
  const house = await prisma.house.upsert({
    where: { inviteCode: INVITE_CODE },
    update: houseData,
    create: { ...houseData, inviteCode: INVITE_CODE },
  });

  for (const { key, role } of MEMBERS) {
    const active = await prisma.houseMember.findFirst({
      where: { houseId: house.id, userId: users[key].id, leftAt: null },
    });
    if (active) {
      await prisma.houseMember.update({
        where: { id: active.id },
        data: { role },
      });
    } else {
      await prisma.houseMember.create({
        data: { houseId: house.id, userId: users[key].id, role },
      });
    }
  }

  await cleanSwaps(house.id);
  await seedChores(house.id, users);
  const activities = await seedRealtime(house.id, users);
  await seedSwaps(house.id, users);
  await seedExpenses(house.id, users);
  await seedAssistantReminders(house.id, users);
  await seedListing(prisma, { houseId: house.id, contactPhone: MEMBERS[0].phone });

  console.log(
    `Seed xong trong ${Date.now() - started}ms: ${house.name} (mã ${INVITE_CODE}), ` +
      `${MEMBERS.length} tài khoản *@nestfair.demo / ${PASSWORD}, 1 vòng quay, ${activities} mục ticker, dữ liệu đổi ca`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

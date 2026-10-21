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

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
import { addDays, currentWeekStart, toDateStr } from '../src/modules/chores/week.js';

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

  await seedChores(house.id, users);

  console.log(
    `Seed xong trong ${Date.now() - started}ms: ${house.name} (mã ${INVITE_CODE}), ` +
      `${MEMBERS.length} tài khoản *@nestfair.demo / ${PASSWORD}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

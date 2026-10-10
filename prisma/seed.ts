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
import { shiftWeek, weekKeyOf, weekRange } from '../src/modules/chores/week.js';

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
  { title: 'Đổ rác', weight: 2 },
  { title: 'Rửa chén', weight: 2 },
  { title: 'Lau nhà', weight: 3 },
  { title: 'Dọn nhà tắm', weight: 3 },
] as const;

const SAMPLE_PROOF_URL =
  'https://res.cloudinary.com/demo/image/upload/sample.jpg';

/**
 * Việc nhà: 3 tuần lịch sử đã DONE + tuần hiện tại (3 ca TODO, 1 ca của Thiện đang chờ duyệt).
 * Xoay vòng kiểu bảng Latin nên không ai lặp lại một việc trong 4 tuần liên tiếp
 * (đủ để demo rào 3 tuần). Chạy lại thì đặt lại trạng thái demo.
 */
async function seedChores(
  houseId: string,
  users: Record<string, { id: string }>,
) {
  const memberIds: string[] = [];
  for (const { key } of MEMBERS) {
    const m = await prisma.houseMember.findFirstOrThrow({
      where: { houseId, userId: users[key].id, leftAt: null },
      select: { id: true },
    });
    memberIds.push(m.id);
  }

  const chores = [];
  for (const c of CHORES) {
    const found = await prisma.chore.findFirst({
      where: { houseId, title: c.title },
    });
    chores.push(
      found
        ? await prisma.chore.update({ where: { id: found.id }, data: { ...c, isActive: true } })
        : await prisma.chore.create({ data: { houseId, ...c } }),
    );
  }

  const thisWeek = weekKeyOf(new Date());
  for (const [offset, back] of [3, 2, 1, 0].entries()) {
    const weekKey = shiftWeek(thisWeek, -back);
    const isCurrent = back === 0;
    for (const [j, chore] of chores.entries()) {
      const assigneeId = memberIds[(j + offset) % memberIds.length];
      const verifier = memberIds[(j + offset + 1) % memberIds.length];
      const pending = isCurrent && assigneeId === memberIds[1];
      const state = isCurrent
        ? pending
          ? ({ status: 'PENDING_VERIFY', proofImageUrl: SAMPLE_PROOF_URL, submittedAt: new Date(), verifiedById: null, verifiedAt: null } as const)
          : ({ status: 'TODO', proofImageUrl: null, submittedAt: null, verifiedById: null, verifiedAt: null } as const)
        : ({ status: 'DONE', proofImageUrl: SAMPLE_PROOF_URL, submittedAt: weekRange(weekKey).start, verifiedById: verifier, verifiedAt: weekRange(weekKey).start } as const);
      const data = {
        houseId,
        assigneeId,
        dueAt: weekRange(weekKey).dueAt,
        source: 'AUTO' as const,
        rejectReason: null,
        ...state,
      };
      await prisma.choreAssignment.upsert({
        where: { choreId_weekKey: { choreId: chore.id, weekKey } },
        update: data,
        create: { choreId: chore.id, weekKey, ...data },
      });
    }
  }
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

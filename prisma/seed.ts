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

/** Giờ trưa (giờ nhà, UTC+7) của một ngày: tránh lệch ngày khi hiển thị theo múi giờ. */
const at = (ymd: string) => new Date(`${ymd}T12:00:00+07:00`);

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
        splits: { create: e.splits.map((s) => ({ userId: id(s.k), allocatedAmount: s.amount })) },
      },
    });
    const ocr = OCR_DRAFTS[e.title];
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
  await seedExpenses(house.id, users);

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

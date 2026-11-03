import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const INVITE_CODE = 'K7M2QZ';

/** Chạy seed thật (`npm run seed`) rồi kiểm dữ liệu demo đổi ca của Nhà 12A (đặc tả mục 13.2). */
describe('Seed demo đổi ca (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const seed = () => spawnSync('npm', ['run', 'seed'], { encoding: 'utf8', shell: true, env: process.env });

  afterAll(() => prisma.$disconnect());

  it('seed chạy được hai lần liên tiếp, dưới 5 giây mỗi lần, không lỗi', () => {
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now();
      const res = seed();
      expect(res.status, res.stderr).toBe(0);
      expect(Date.now() - t0).toBeLessThan(20_000); // gồm cả khởi động tsx; thời gian seed in ra trong log
      expect(res.stdout).toMatch(/Seed xong trong (\d+)ms/);
      expect(Number(/Seed xong trong (\d+)ms/.exec(res.stdout)![1])).toBeLessThan(5000);
    }
  }, 120_000);

  it('có đủ dữ liệu demo đổi ca', async () => {
    const house = await prisma.house.findUniqueOrThrow({ where: { inviteCode: INVITE_CODE } });
    const swaps = await prisma.choreSwapRequest.findMany({ where: { houseId: house.id } });
    const debts = await prisma.choreDebt.findMany({ where: { houseId: house.id } });

    // Đúng một Chợ ca kèm quà 30.000đ đang chờ.
    const market = swaps.filter((s) => s.status === 'PENDING' && s.targetMemberId === null);
    expect(market).toHaveLength(1);
    expect(market[0]).toMatchObject({ type: 'COVER', compensation: 'GIFT', rewardAmount: 30000 });
    expect(market[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Đúng một EXCHANGE đang chờ, có khóa cho cả hai ca.
    const exchange = swaps.filter((s) => s.status === 'PENDING' && s.type === 'EXCHANGE');
    expect(exchange).toHaveLength(1);
    const locks = await prisma.swapLock.findMany({ where: { swapRequestId: { in: swaps.map((s) => s.id) } } });
    expect(locks.map((l) => l.assignmentId).sort((a, b) => a.localeCompare(b))).toEqual(
      [market[0].fromAssignmentId, exchange[0].fromAssignmentId, exchange[0].toAssignmentId].sort((a, b) => String(a).localeCompare(String(b))),
    );

    // Chuỗi hết hạn chờ leo thang: một yêu cầu đã ADD_REWARD, một yêu cầu EXPIRED chưa chọn, cùng rootRequestId.
    const expired = swaps.filter((s) => s.status === 'EXPIRED');
    expect(expired).toHaveLength(2);
    expect(new Set(expired.map((s) => s.rootRequestId)).size).toBe(1);
    expect(expired.filter((s) => s.escalationChoice === 'ADD_REWARD')).toHaveLength(1);
    const awaiting = expired.find((s) => s.escalationChoice === null)!;
    expect(awaiting.escalationDeadline!.getTime()).toBeGreaterThan(Date.now());

    // Hai nợ ca OPEN: một đã tới cửa sổ chọn bù, một chờ ca gốc DONE.
    expect(debts.filter((d) => d.status === 'OPEN')).toHaveLength(2);
    const inWindow = debts.find((d) => d.pickOpensAt !== null)!;
    expect(inWindow.pickOpensAt!.getTime()).toBeLessThan(Date.now());
    expect(inWindow.pickDeadlineAt!.getTime()).toBeGreaterThan(Date.now());
    const waiting = debts.find((d) => d.pickOpensAt === null)!;
    const cover = await prisma.choreAssignment.findUniqueOrThrow({ where: { id: waiting.coverAssignmentId } });
    expect(cover.status).toBe('TODO');
    const doneCover = await prisma.choreAssignment.findUniqueOrThrow({ where: { id: inWindow.coverAssignmentId } });
    expect(doneCover.status).toBe('DONE');

    // Hai slot WHEEL "Thông bồn cầu" cùng việc, cùng ngày.
    const wheel = await prisma.choreAssignment.findMany({ where: { houseId: house.id, source: 'WHEEL', titleSnapshot: 'Thông bồn cầu' } });
    expect(wheel).toHaveLength(2);
    expect(new Set(wheel.map((w) => w.choreId)).size).toBe(1);
    expect(new Set(wheel.map((w) => w.occurrenceDate.toISOString())).size).toBe(1);

    // Còn một ca PENDING_VERIFY, một ca MISSED, và có hoạt động ticker.
    expect(await prisma.choreAssignment.count({ where: { houseId: house.id, status: 'PENDING_VERIFY' } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.choreAssignment.count({ where: { houseId: house.id, status: 'MISSED' } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.houseActivity.count({ where: { houseId: house.id } })).toBeGreaterThan(0);
  });

  it('lịch sử 3 tuần W41–W43 (ba tuần trước tuần hiện tại) vẫn còn để demo rào', async () => {
    const house = await prisma.house.findUniqueOrThrow({ where: { inviteCode: INVITE_CODE } });
    expect(await prisma.weekSchedule.count({ where: { houseId: house.id } })).toBe(5);
  });

  it('seed trong không có yêu cầu PENDING nào bị khóa thiếu: mọi PENDING có khóa và mọi khóa thuộc PENDING', async () => {
    const house = await prisma.house.findUniqueOrThrow({ where: { inviteCode: INVITE_CODE } });
    const pending = await prisma.choreSwapRequest.findMany({ where: { houseId: house.id, status: 'PENDING' } });
    const slotIds = (await prisma.choreAssignment.findMany({ where: { houseId: house.id }, select: { id: true } })).map((a) => a.id);
    const locks = await prisma.swapLock.findMany({ where: { assignmentId: { in: slotIds } } });
    expect(locks.map((l) => l.swapRequestId).every((id) => pending.some((p) => p.id === id))).toBe(true);
    expect(locks).toHaveLength(pending.reduce((n, p) => n + (p.toAssignmentId ? 2 : 1), 0));
  });
});

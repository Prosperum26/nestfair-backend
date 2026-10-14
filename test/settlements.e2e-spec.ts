import { createFixture, type TestUser } from './support/house-fixture.js';

describe('Settlements (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  beforeAll(async () => {
    fx = await createFixture('@e2e-settlements.nestfair.test');
  });
  afterAll(() => fx.cleanup());

  const url = (houseId: string, tail = '') => `/api/v1/houses/${houseId}${tail}`;

  /** `creditor` trả hộ `debtor` toàn bộ `amount`: một quan hệ nợ debtor → creditor. */
  const debt = (houseId: string, creditor: TestUser, debtor: TestUser, amount: number) =>
    fx
      .as(creditor.token)
      .post(url(houseId, '/expenses'), {
        title: 'Nợ',
        category: 'OTHER',
        totalAmount: amount,
        splitType: 'EXACT',
        spentAt: '2026-10-05T12:00:00+07:00',
        splits: [{ userId: debtor.id, amount }],
      })
      .expect(201);

  /** Nhà 4 người với 6 quan hệ nợ chéo của ảnh 09 (640.000đ). */
  async function image09House() {
    const house = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
    const [H, T, M, Q] = house.users;
    await debt(house.houseId, M, H, 145_000);
    await debt(house.houseId, M, Q, 40_000);
    await debt(house.houseId, Q, H, 75_000);
    await debt(house.houseId, M, T, 195_000);
    await debt(house.houseId, H, T, 50_000);
    await debt(house.houseId, Q, T, 135_000);
    return { ...house, H, T, M, Q };
  }

  describe('GET /settlements/plan', () => {
    it('ảnh 09: 6 khoản nợ chéo (640.000đ) rút gọn còn 2 giao dịch (550.000đ)', async () => {
      const { houseId, H, T, M, Q } = await image09House();
      const res = await fx.as(H.token).get(url(houseId, '/settlements/plan')).expect(200);

      expect(res.body.raw).toHaveLength(6);
      expect(res.body.rawTotal).toBe(640_000);
      expect(res.body.optimized).toHaveLength(2);
      expect(res.body.optimizedTotal).toBe(550_000);
      expect(res.body.optimized).toEqual(
        expect.arrayContaining([
          { fromUserId: T.id, toUserId: M.id, amount: 380_000, pending: null },
          { fromUserId: H.id, toUserId: Q.id, amount: 170_000, pending: null },
        ]),
      );
      const net = Object.fromEntries(res.body.members.map((x: { id: string; net: number }) => [x.id, x.net]));
      expect(net).toEqual({ [M.id]: 380_000, [Q.id]: 170_000, [H.id]: -170_000, [T.id]: -380_000 });
      expect(res.body.members.every((x: { active: boolean }) => x.active)).toBe(true);
      // Thứ tự thành viên theo ngày vào nhà, có tên để vẽ sơ đồ.
      expect(res.body.members.map((x: { fullName: string }) => x.fullName)).toEqual(['Hùng', 'Thiện', 'Mai', 'Quân']);
    });

    it('nhà chưa có khoản chi: mọi người số dư 0, không có giao dịch', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const res = await fx.as(users[0].token).get(url(houseId, '/settlements/plan')).expect(200);
      expect(res.body).toMatchObject({ raw: [], optimized: [], rawTotal: 0, optimizedTotal: 0 });
      expect(res.body.members.map((x: { net: number }) => x.net)).toEqual([0, 0]);
    });

    it('settlement CONFIRMED trừ vào số dư; PENDING gắn vào cạnh tương ứng mà không đổi số tiền', async () => {
      const { houseId, H, T, M, Q } = await image09House();
      await fx.prisma.settlement.create({
        data: { houseId, fromUserId: T.id, toUserId: M.id, amount: 100_000, status: 'CONFIRMED', confirmedAt: new Date() },
      });
      const pending = await fx.prisma.settlement.create({
        data: { houseId, fromUserId: H.id, toUserId: Q.id, amount: 170_000, status: 'PENDING' },
      });
      await fx.prisma.settlement.create({
        data: { houseId, fromUserId: T.id, toUserId: Q.id, amount: 5_000, status: 'CANCELLED' },
      });

      const res = await fx.as(T.token).get(url(houseId, '/settlements/plan')).expect(200);
      expect(res.body.optimized).toEqual(
        expect.arrayContaining([
          { fromUserId: T.id, toUserId: M.id, amount: 280_000, pending: null },
          {
            fromUserId: H.id,
            toUserId: Q.id,
            amount: 170_000,
            pending: { id: pending.id, amount: 170_000, createdAt: pending.createdAt.toISOString(), proofUrl: null },
          },
        ]),
      );
      expect(res.body.optimizedTotal).toBe(450_000);
      // Cạnh "trước" của cặp Thiện → Mai giảm theo đúng settlement đã xác nhận.
      expect(res.body.raw).toContainEqual({ fromUserId: T.id, toUserId: M.id, amount: 95_000 });
    });

    it('người đã rời nhà còn số dư vẫn có trong kế hoạch (active: false); hết số dư thì ẩn', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
      const [hung, thien, mai] = users;
      await debt(houseId, hung, mai, 60_000);
      await fx.prisma.houseMember.updateMany({ where: { houseId, userId: mai.id }, data: { leftAt: new Date() } });

      const res = await fx.as(hung.token).get(url(houseId, '/settlements/plan')).expect(200);
      expect(res.body.members).toContainEqual(expect.objectContaining({ id: mai.id, active: false, net: -60_000 }));
      expect(res.body.optimized).toEqual([{ fromUserId: mai.id, toUserId: hung.id, amount: 60_000, pending: null }]);

      await fx.prisma.settlement.create({
        data: { houseId, fromUserId: mai.id, toUserId: hung.id, amount: 60_000, status: 'CONFIRMED', confirmedAt: new Date() },
      });
      const after = await fx.as(thien.token).get(url(houseId, '/settlements/plan')).expect(200);
      expect(after.body.members.map((x: { id: string }) => x.id)).not.toContain(mai.id);
      expect(after.body.optimized).toEqual([]);
    });

    it('người ngoài nhà → 403', async () => {
      const { houseId } = await fx.houseWith(['Hùng', 'Thiện']);
      const outsider = await fx.user('Người lạ');
      await fx.as(outsider.token).get(url(houseId, '/settlements/plan')).expect(403);
    });
  });

  describe('GET /settlements/payment-info/:userId', () => {
    it('trả STK đầy đủ và tên chủ tài khoản bỏ dấu cho thành viên cùng nhà', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Nguyễn Minh Quân']);
      const [hung, quan] = users;
      await fx.prisma.user.update({ where: { id: quan.id }, data: { bankBin: '970422', bankAccount: '0801234566789' } });

      const res = await fx.as(hung.token).get(url(houseId, `/settlements/payment-info/${quan.id}`)).expect(200);
      expect(res.body).toEqual({
        userId: quan.id,
        fullName: 'Nguyễn Minh Quân',
        bankBin: '970422',
        bankAccount: '0801234566789',
        accountName: 'NGUYEN MINH QUAN',
      });
    });

    it('chưa có tài khoản → 404 PAYMENT_INFO_MISSING; người nhà khác → 404 MEMBER_NOT_FOUND; người ngoài gọi → 403', async () => {
      const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
      const other = await fx.houseWith(['Lan', 'Huệ']);
      await fx.prisma.user.update({ where: { id: other.users[0].id }, data: { bankBin: '970436', bankAccount: '0071000444456' } });

      const missing = await fx.as(users[0].token).get(url(houseId, `/settlements/payment-info/${users[1].id}`)).expect(404);
      expect(missing.body).toMatchObject({ statusCode: 404, code: 'PAYMENT_INFO_MISSING' });
      const foreign = await fx.as(users[0].token).get(url(houseId, `/settlements/payment-info/${other.users[0].id}`)).expect(404);
      expect(foreign.body.code).toBe('MEMBER_NOT_FOUND');
      await fx.as(other.users[1].token).get(url(houseId, `/settlements/payment-info/${users[0].id}`)).expect(403);
      await fx.as(users[0].token).get(url(houseId, '/settlements/payment-info/abc')).expect(400);
    });
  });
});

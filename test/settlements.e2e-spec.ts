import { vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { png } from './support/assignment-fixture.js';
import { createFixture, type TestUser } from './support/house-fixture.js';

describe('Settlements (e2e)', () => {
  const upload = vi.fn();
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let seq = 0;
  beforeAll(async () => {
    fx = await createFixture('@e2e-settlements.nestfair.test', (b) =>
      b.overrideProvider(CloudinaryService).useValue({ upload, destroy: vi.fn() }),
    );
  });
  beforeEach(() => {
    upload.mockReset();
    upload.mockImplementation(async (_buf: Buffer, folder: string) => {
      const publicId = `nestfair/${folder}/b${++seq}`;
      return { url: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.png`, publicId };
    });
  });
  afterEach(() => vi.restoreAllMocks());
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

  describe('báo chuyển → xác nhận / hủy', () => {
    const report = (houseId: string, from: TestUser, body: object) => fx.as(from.token).post(url(houseId, '/settlements'), body);
    const confirm = (houseId: string, who: TestUser, id: string) => fx.as(who.token).patch(url(houseId, `/settlements/${id}/confirm`));
    const cancel = (houseId: string, who: TestUser, id: string) => fx.as(who.token).patch(url(houseId, `/settlements/${id}/cancel`));
    const plan = (houseId: string, who: TestUser) => fx.as(who.token).get(url(houseId, '/settlements/plan')).expect(200).then((r) => r.body);
    const netOf = (body: { members: { id: string; net: number }[] }) => Object.fromEntries(body.members.map((x) => [x.id, x.net]));

    it('DoD: Thiện báo chuyển 380k → chưa đổi số dư; Mai xác nhận → CONFIRMED, số dư cập nhật, chỉ còn Hùng → Quân', async () => {
      const { houseId, H, T, M, Q } = await image09House();
      const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');

      const created = await report(houseId, T, { toUserId: M.id, amount: 380_000, note: 'CK Vietcombank' }).expect(201);
      expect(created.body).toMatchObject({ from: { id: T.id }, to: { id: M.id }, amount: 380_000, status: 'PENDING', confirmedAt: null });
      expect(emit).toHaveBeenCalledWith(houseId, 'settlement:requested', {
        settlementId: created.body.id,
        fromUserId: T.id,
        toUserId: M.id,
        amount: 380_000,
      });

      const pendingPlan = await plan(houseId, T);
      expect(netOf(pendingPlan)[T.id]).toBe(-380_000);
      expect(pendingPlan.optimized).toContainEqual(expect.objectContaining({ fromUserId: T.id, toUserId: M.id, pending: expect.objectContaining({ id: created.body.id }) }));

      const confirmed = await confirm(houseId, M, created.body.id).expect(200);
      expect(confirmed.body.status).toBe('CONFIRMED');
      expect(confirmed.body.confirmedAt).toBeTruthy();
      expect(emit).toHaveBeenCalledWith(houseId, 'debt:settled', {
        settlementId: created.body.id,
        fromUserId: T.id,
        toUserId: M.id,
        amount: 380_000,
      });

      const after = await plan(houseId, H);
      expect(netOf(after)).toEqual({ [H.id]: -170_000, [T.id]: 0, [M.id]: 0, [Q.id]: 170_000 });
      expect(after.optimized).toEqual([{ fromUserId: H.id, toUserId: Q.id, amount: 170_000, pending: null }]);
      // Bất biến: tổng số dư luôn bằng 0.
      expect(Object.values(netOf(after)).reduce((s, v) => s + v, 0)).toBe(0);
    });

    it('chỉ người nhận xác nhận được; xác nhận lần hai → 409; hai yêu cầu song song chỉ một thành công', async () => {
      const { houseId, H, T, M, Q } = await image09House();
      const s1 = await report(houseId, T, { toUserId: M.id, amount: 380_000 }).expect(201);
      expect((await confirm(houseId, T, s1.body.id).expect(403)).body.code).toBe('NOT_SETTLEMENT_RECEIVER');
      expect((await confirm(houseId, Q, s1.body.id).expect(403)).body.code).toBe('NOT_SETTLEMENT_RECEIVER');
      await confirm(houseId, M, s1.body.id).expect(200);
      expect((await confirm(houseId, M, s1.body.id).expect(409)).body.code).toBe('SETTLEMENT_NOT_PENDING');

      // Bấm đúp: hai request xác nhận cùng lúc.
      const s2 = await report(houseId, H, { toUserId: Q.id, amount: 170_000 }).expect(201);
      const results = await Promise.all([confirm(houseId, Q, s2.body.id), confirm(houseId, Q, s2.body.id)]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
      expect(await fx.prisma.settlement.count({ where: { houseId, status: 'CONFIRMED' } })).toBe(2);
      expect(netOf(await plan(houseId, H))).toEqual({ [H.id]: 0, [T.id]: 0, [M.id]: 0, [Q.id]: 0 });
    });

    it('chặn báo chuyển sai: cho chính mình, người không được nhận, vượt số nợ, báo trùng, người ngoài nhà', async () => {
      const { houseId, H, T, M, Q } = await image09House();
      const outsider = await fx.user('Người lạ');
      expect((await report(houseId, T, { toUserId: T.id, amount: 1_000 }).expect(422)).body.code).toBe('SETTLEMENT_SELF');
      // Hùng đang nợ ròng, không phải chủ nợ.
      expect((await report(houseId, T, { toUserId: H.id, amount: 1_000 }).expect(422)).body.code).toBe('SETTLEMENT_AMOUNT_EXCEEDS_DEBT');
      // Mai là chủ nợ, không có gì để trả.
      expect((await report(houseId, M, { toUserId: Q.id, amount: 1_000 }).expect(422)).body.code).toBe('SETTLEMENT_AMOUNT_EXCEEDS_DEBT');
      const over = await report(houseId, T, { toUserId: M.id, amount: 380_001 }).expect(422);
      expect(over.body).toMatchObject({ code: 'SETTLEMENT_AMOUNT_EXCEEDS_DEBT', message: 'Số tiền tối đa có thể trả cho người này là 380.000đ.' });
      expect((await report(houseId, T, { toUserId: outsider.id, amount: 1_000 }).expect(422)).body.code).toBe('NOT_A_HOUSE_MEMBER');
      await fx.as(outsider.token).post(url(houseId, '/settlements'), { toUserId: M.id, amount: 1_000 }).expect(403);

      // Trả một phần được; báo thứ hai cho cùng người khi báo đầu còn chờ → 409.
      await report(houseId, T, { toUserId: M.id, amount: 100_000 }).expect(201);
      expect((await report(houseId, T, { toUserId: M.id, amount: 50_000 }).expect(409)).body.code).toBe('SETTLEMENT_ALREADY_PENDING');

      // Quân chỉ được nhận 170k: Thiện báo 170k cho Quân thì Hùng không còn báo trả Quân được nữa.
      await report(houseId, T, { toUserId: Q.id, amount: 170_000 }).expect(201);
      expect((await report(houseId, H, { toUserId: Q.id, amount: 1_000 }).expect(422)).body.code).toBe('SETTLEMENT_AMOUNT_EXCEEDS_DEBT');
      // Báo chuyển đang chờ chưa làm đổi số dư nên kế hoạch vẫn nguyên 550.000đ.
      const plan2 = await plan(houseId, T);
      expect(plan2.optimizedTotal).toBe(550_000);
    });

    it('hai báo chuyển song song cùng cặp: chỉ một được tạo', async () => {
      const { houseId, T, M } = await image09House();
      const results = await Promise.all([
        report(houseId, T, { toUserId: M.id, amount: 100_000 }),
        report(houseId, T, { toUserId: M.id, amount: 100_000 }),
      ]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(await fx.prisma.settlement.count({ where: { houseId, status: 'PENDING' } })).toBe(1);
    });

    it('dữ liệu sai → 400: tiền lẻ, 0đ, thiếu người nhận, tự điền người chuyển (không giả mạo được)', async () => {
      const { houseId, H, T, M } = await image09House();
      await report(houseId, T, { toUserId: M.id, amount: 1000.5 }).expect(400);
      await report(houseId, T, { toUserId: M.id, amount: 0 }).expect(400);
      await report(houseId, T, { amount: 1_000 }).expect(400);
      await report(houseId, T, { toUserId: M.id, amount: 1_000, fromUserId: H.id }).expect(400);
      await report(houseId, T, { toUserId: M.id, amount: 1_000, status: 'CONFIRMED' }).expect(400);
    });

    it('hủy: người chuyển rút lại hoặc người nhận báo chưa nhận; người thứ ba 403; hủy xong báo lại được', async () => {
      const { houseId, H, T, M } = await image09House();
      const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');
      const s1 = await report(houseId, T, { toUserId: M.id, amount: 380_000 }).expect(201);
      expect((await cancel(houseId, H, s1.body.id).expect(403)).body.code).toBe('NOT_SETTLEMENT_PARTY');
      const cancelled = await cancel(houseId, T, s1.body.id).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', confirmedAt: null });
      expect(emit).toHaveBeenCalledWith(houseId, 'settlement:cancelled', { settlementId: s1.body.id, fromUserId: T.id, toUserId: M.id });
      expect((await confirm(houseId, M, s1.body.id).expect(409)).body.code).toBe('SETTLEMENT_NOT_PENDING');

      const s2 = await report(houseId, T, { toUserId: M.id, amount: 380_000 }).expect(201);
      await cancel(houseId, M, s2.body.id).expect(200);
      expect(netOf(await plan(houseId, T))[T.id]).toBe(-380_000);

      const s3 = await report(houseId, T, { toUserId: M.id, amount: 380_000 }).expect(201);
      await confirm(houseId, M, s3.body.id).expect(200);
      expect((await cancel(houseId, T, s3.body.id).expect(409)).body.code).toBe('SETTLEMENT_NOT_PENDING');
    });

    it('không thao tác chéo nhà: id của nhà khác → 404', async () => {
      const a = await image09House();
      const b = await fx.houseWith(['Lan', 'Huệ']);
      const s = await report(a.houseId, a.T, { toUserId: a.M.id, amount: 1_000 }).expect(201);
      expect((await confirm(b.houseId, b.users[0], s.body.id).expect(404)).body.code).toBe('SETTLEMENT_NOT_FOUND');
      expect((await cancel(b.houseId, b.users[0], s.body.id).expect(404)).body.code).toBe('SETTLEMENT_NOT_FOUND');
      await fx.as(a.M.token).patch(url(a.houseId, '/settlements/abc/confirm')).expect(400);
    });

    it('lịch sử: mới nhất trước, lọc theo tháng và scope=mine', async () => {
      const { houseId, H, T, M, Q } = await image09House();
      const s1 = await report(houseId, T, { toUserId: M.id, amount: 380_000 }).expect(201);
      await confirm(houseId, M, s1.body.id).expect(200);
      const s2 = await report(houseId, H, { toUserId: Q.id, amount: 170_000 }).expect(201);
      // Đẩy s1 về tháng 9 để kiểm tra lọc tháng.
      await fx.prisma.settlement.update({ where: { id: s1.body.id }, data: { createdAt: new Date('2026-09-30T05:00:00Z') } });

      const ids = (q: string, who: TestUser = H) =>
        fx.as(who.token).get(url(houseId, `/settlements${q}`)).expect(200).then((r) => r.body.map((x: { id: string }) => x.id));
      expect(await ids('')).toEqual([s2.body.id, s1.body.id]);
      expect(await ids('?month=2026-09')).toEqual([s1.body.id]);
      expect(await ids('?scope=mine')).toEqual([s2.body.id]);
      expect(await ids('?scope=mine', M)).toEqual([s1.body.id]);
      const full = await fx.as(H.token).get(url(houseId, '/settlements')).expect(200);
      expect(full.body[1]).toMatchObject({ from: { id: T.id, fullName: 'Thiện' }, to: { id: M.id, fullName: 'Mai' }, status: 'CONFIRMED' });
      await fx.as(H.token).get(url(houseId, '/settlements?scope=everyone')).expect(400);
    });

    it('bill chuyển khoản: tải lên theo thư mục nhà, chỉ nhận URL của chính nhà', async () => {
      const { houseId, T, M } = await image09House();
      const other = await fx.houseWith(['Lan', 'Huệ']);
      const uploadAs = (who: TestUser, hid: string) =>
        fx.http().post(url(hid, '/settlements/proof')).set('Authorization', `Bearer ${who.token}`).attach('photo', png(), { filename: 'bill', contentType: 'image/png' });

      const mine = await uploadAs(T, houseId).expect(201);
      expect(upload).toHaveBeenCalledWith(expect.any(Buffer), `houses/${houseId}/settlements`);
      const foreign = await uploadAs(other.users[0], other.houseId).expect(201);

      expect((await report(houseId, T, { toUserId: M.id, amount: 1_000, proofUrl: foreign.body.url }).expect(422)).body.code).toBe('PROOF_URL_INVALID');
      const ok = await report(houseId, T, { toUserId: M.id, amount: 1_000, proofUrl: mine.body.url }).expect(201);
      expect(ok.body.proofUrl).toBe(mine.body.url);
    });
  });
});

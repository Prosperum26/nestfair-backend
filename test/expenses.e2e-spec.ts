import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { png } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

describe('Expenses (e2e)', () => {
  const upload = vi.fn();
  const destroy = vi.fn();
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let seq = 0;

  beforeAll(async () => {
    fx = await createFixture('@e2e-expenses.nestfair.test', (b) => b.overrideProvider(CloudinaryService).useValue({ upload, destroy }));
  });
  beforeEach(() => {
    upload.mockReset();
    destroy.mockReset();
    // Giống Cloudinary thật: URL chứa thư mục theo nhà, publicIdFromUrl đọc lại được.
    upload.mockImplementation(async (_buf: Buffer, folder: string) => {
      const publicId = `nestfair/${folder}/r${++seq}`;
      return { url: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.png`, publicId };
    });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const url = (houseId: string, tail = '') => `/api/v1/houses/${houseId}/expenses${tail}`;
  const OCT = '2026-10-05T12:00:00+07:00';
  const base = { title: 'Tiền điện', category: 'ELECTRICITY', totalAmount: 100_000, splitType: 'EQUAL', spentAt: OCT };
  const amountsOf = (body: { splits: { userId: string; amount: number }[] }) =>
    Object.fromEntries(body.splits.map((s) => [s.userId, s.amount]));

  it('EQUAL chia cả nhà theo thứ tự vào nhà, dư 1đ cho người vào trước; emit expense:new', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const [hung, thien, mai] = users;
    const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');

    const res = await fx.as(thien.token).post(url(houseId), base).expect(201);
    expect(res.body).toMatchObject({ totalAmount: 100_000, splitType: 'EQUAL', payer: { id: thien.id }, createdById: thien.id, canEdit: true });
    expect(amountsOf(res.body)).toEqual({ [hung.id]: 33_334, [thien.id]: 33_333, [mai.id]: 33_333 });
    expect(res.body.myShare).toBe(33_333);
    expect(emit).toHaveBeenCalledWith(houseId, 'expense:new', {
      expenseId: res.body.id,
      title: 'Tiền điện',
      payer: { id: thien.id, fullName: 'Thiện' },
      amount: 100_000,
      fromReceipt: false,
    });

    const saved = await fx.prisma.expenseSplit.aggregate({ where: { expenseId: res.body.id }, _sum: { allocatedAmount: true } });
    expect(saved._sum.allocatedAmount).toBe(100_000);
  });

  it('CUSTOM chỉ chia cho người được chọn; người khác thấy myShare 0 và không sửa được', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const [hung, thien, mai] = users;
    const res = await fx
      .as(thien.token)
      .post(url(houseId), { ...base, splitType: 'CUSTOM', totalAmount: 100_001, participantIds: [mai.id, thien.id] })
      .expect(201);
    // Sắp theo thứ tự vào nhà (Thiện trước Mai), không theo thứ tự client gửi.
    expect(amountsOf(res.body)).toEqual({ [thien.id]: 50_001, [mai.id]: 50_000 });

    const seenByMai = await fx.as(mai.token).get(url(houseId, `/${res.body.id}`)).expect(200);
    expect(seenByMai.body).toMatchObject({ myShare: 50_000, canEdit: false });
    const seenByHung = await fx.as(hung.token).get(url(houseId, `/${res.body.id}`)).expect(200);
    // Hùng là trưởng phòng: không chịu phần nhưng được sửa.
    expect(seenByHung.body).toMatchObject({ myShare: 0, canEdit: true });

    await fx.as(thien.token).post(url(houseId), { ...base, splitType: 'CUSTOM' }).expect(422);
  });

  it('EXACT: tổng khớp thì lưu, lệch thì 422 SPLIT_SUM_MISMATCH; người trả có thể không chịu phần', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
    const [hung, thien, mai, quan] = users;
    const splits = [
      { userId: hung.id, amount: 110_000 },
      { userId: thien.id, amount: 120_000 },
      { userId: mai.id, amount: 140_000 },
      { userId: quan.id, amount: 150_000 },
    ];
    const ok = await fx
      .as(quan.token)
      .post(url(houseId), { ...base, title: 'Đi chợ', category: 'FOOD', totalAmount: 520_000, splitType: 'EXACT', splits })
      .expect(201);
    expect(amountsOf(ok.body)).toEqual({ [hung.id]: 110_000, [thien.id]: 120_000, [mai.id]: 140_000, [quan.id]: 150_000 });

    const bad = await fx
      .as(quan.token)
      .post(url(houseId), { ...base, totalAmount: 520_000, splitType: 'EXACT', splits: splits.slice(0, 3) })
      .expect(422);
    expect(bad.body).toMatchObject({ statusCode: 422, code: 'SPLIT_SUM_MISMATCH', error: 'Unprocessable Entity' });

    // Quân trả hộ Hùng toàn bộ: Quân không chịu phần nào.
    const lent = await fx
      .as(quan.token)
      .post(url(houseId), { ...base, totalAmount: 50_000, splitType: 'EXACT', splits: [{ userId: hung.id, amount: 50_000 }, { userId: quan.id, amount: 0 }] })
      .expect(201);
    expect(lent.body.splits).toHaveLength(1);
    expect(lent.body.myShare).toBe(0);
  });

  it('ITEMIZED chưa hỗ trợ (422); trộn dữ liệu sai kiểu chia (422 SPLIT_INVALID)', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const post = (body: object) => fx.as(users[0].token).post(url(houseId), { ...base, ...body });
    expect((await post({ splitType: 'ITEMIZED' }).expect(422)).body.code).toBe('SPLIT_TYPE_NOT_SUPPORTED');
    expect((await post({ participantIds: [users[1].id] }).expect(422)).body.code).toBe('SPLIT_INVALID');
    expect((await post({ splits: [{ userId: users[1].id, amount: 100_000 }] }).expect(422)).body.code).toBe('SPLIT_INVALID');
    expect((await post({ splitType: 'EXACT' }).expect(422)).body.code).toBe('SPLIT_INVALID');
  });

  it('dữ liệu sai → 400 (tiền lẻ, 0đ, quá trần, tên rỗng, field lạ, danh mục lạ, ngày sai)', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const post = (body: object) => fx.as(users[0].token).post(url(houseId), { ...base, ...body });
    await post({ totalAmount: 1000.5 }).expect(400);
    await post({ totalAmount: 0 }).expect(400);
    await post({ totalAmount: 2_000_000_000 }).expect(400);
    await post({ totalAmount: '100000' }).expect(400);
    await post({ title: '   ' }).expect(400);
    await post({ houseId: randomUUID() }).expect(400);
    await post({ category: 'KITCHEN' }).expect(400);
    await post({ spentAt: '05/10/2026' }).expect(400);
    await post({ splitType: 'EXACT', splits: [{ userId: users[0].id, amount: -1 }] }).expect(400);
  });

  it('ngày chi ở tương lai xa → 422 SPENT_AT_IN_FUTURE; bỏ trống thì lấy bây giờ', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect((await fx.as(users[0].token).post(url(houseId), { ...base, spentAt: future }).expect(422)).body.code).toBe('SPENT_AT_IN_FUTURE');
    const { spentAt: _drop, ...noDate } = base;
    const res = await fx.as(users[0].token).post(url(houseId), noDate).expect(201);
    expect(Math.abs(new Date(res.body.spentAt).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('người ngoài nhà: không đọc/ghi được (403), không làm người trả/người chịu được (422), không xem chéo nhà (404)', async () => {
    const a = await fx.houseWith(['Hùng', 'Thiện']);
    const b = await fx.houseWith(['Lan', 'Huệ']);
    const outsider = await fx.user('Người lạ');
    await fx.as(outsider.token).get(url(a.houseId)).expect(403);
    await fx.as(outsider.token).post(url(a.houseId), base).expect(403);

    const asHung = fx.as(a.users[0].token);
    expect((await asHung.post(url(a.houseId), { ...base, payerId: outsider.id }).expect(422)).body.code).toBe('NOT_A_HOUSE_MEMBER');
    expect(
      (await asHung.post(url(a.houseId), { ...base, splitType: 'CUSTOM', participantIds: [a.users[1].id, b.users[0].id] }).expect(422)).body.code,
    ).toBe('NOT_A_HOUSE_MEMBER');

    // Khoản chi của nhà B không truy cập được qua URL nhà A (chống IDOR).
    const inB = await fx.as(b.users[0].token).post(url(b.houseId), base).expect(201);
    await asHung.get(url(a.houseId, `/${inB.body.id}`)).expect(404);
    await asHung.patch(url(a.houseId, `/${inB.body.id}`), { title: 'Hack' }).expect(404);
    await asHung.delete(url(a.houseId, `/${inB.body.id}`)).expect(404);
    await asHung.get(url(a.houseId, '/not-a-uuid')).expect(400);
  });

  it('danh sách lọc theo tháng (giờ VN), người trả, danh mục, từ khóa; mới nhất lên đầu', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const [hung, thien] = users;
    const post = (token: string, body: object) => fx.as(token).post(url(houseId), { ...base, ...body }).expect(201);
    await post(hung.token, { title: 'Wifi tháng 10', category: 'INTERNET', spentAt: '2026-10-03T12:00:00+07:00' });
    await post(thien.token, { title: 'Tiền nước', category: 'WATER', spentAt: '2026-10-02T12:00:00+07:00' });
    // Ranh giới tháng theo giờ VN: 00:30 ngày 01.10 (30.09 UTC) thuộc tháng 10, 23:30 ngày 30.09 thuộc tháng 9.
    await post(hung.token, { title: 'Đầu tháng 10', spentAt: '2026-10-01T00:30:00+07:00' });
    await post(hung.token, { title: 'Cuối tháng 9', spentAt: '2026-09-30T23:30:00+07:00' });

    const list = (q: string) => fx.as(hung.token).get(url(houseId, q)).expect(200).then((r) => r.body.map((e: { title: string }) => e.title));
    expect(await list('?month=2026-10')).toEqual(['Wifi tháng 10', 'Tiền nước', 'Đầu tháng 10']);
    expect(await list('?month=2026-09')).toEqual(['Cuối tháng 9']);
    expect(await list(`?month=2026-10&payerId=${thien.id}`)).toEqual(['Tiền nước']);
    expect(await list('?month=2026-10&category=INTERNET')).toEqual(['Wifi tháng 10']);
    expect(await list('?month=2026-10&q=wifi')).toEqual(['Wifi tháng 10']);
    expect(await list('?month=2026-10&q=thiện')).toEqual(['Tiền nước']);
    await fx.as(hung.token).get(url(houseId, '?month=2026-13')).expect(400);
  });

  it('sửa: đổi tên giữ phần chia; đổi tiền thì chia lại; quyền người trả / người ghi / trưởng phòng', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const [hung, thien, mai] = users;
    const created = await fx.as(thien.token).post(url(houseId), { ...base, totalAmount: 90_000 }).expect(201);
    const id = created.body.id as string;
    const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');

    await fx.as(mai.token).patch(url(houseId, `/${id}`), { title: 'Mai sửa' }).expect(403);

    const renamed = await fx.as(thien.token).patch(url(houseId, `/${id}`), { title: 'Tiền điện T10', note: 'Chốt ngày 05' }).expect(200);
    expect(renamed.body).toMatchObject({ title: 'Tiền điện T10', note: 'Chốt ngày 05', totalAmount: 90_000 });
    expect(amountsOf(renamed.body)).toEqual(amountsOf(created.body));
    expect(emit).toHaveBeenCalledWith(houseId, 'expense:updated', { expenseId: id });

    const resplit = await fx.as(hung.token).patch(url(houseId, `/${id}`), { totalAmount: 100_000 }).expect(200);
    expect(amountsOf(resplit.body)).toEqual({ [hung.id]: 33_334, [thien.id]: 33_333, [mai.id]: 33_333 });

    const toCustom = await fx
      .as(thien.token)
      .patch(url(houseId, `/${id}`), { splitType: 'CUSTOM', participantIds: [thien.id, mai.id] })
      .expect(200);
    expect(amountsOf(toCustom.body)).toEqual({ [thien.id]: 50_000, [mai.id]: 50_000 });
    // Đổi tiền của CUSTOM giữ nhóm người cũ.
    const customTotal = await fx.as(thien.token).patch(url(houseId, `/${id}`), { totalAmount: 60_000 }).expect(200);
    expect(amountsOf(customTotal.body)).toEqual({ [thien.id]: 30_000, [mai.id]: 30_000 });

    // Sang EXACT mà không gửi số tiền từng người → 422.
    await fx.as(thien.token).patch(url(houseId, `/${id}`), { splitType: 'EXACT' }).expect(422);
    // Bản ghi không bị đổi khi lỗi.
    const after = await fx.prisma.expenseSplit.findMany({ where: { expenseId: id } });
    expect(after.reduce((s, x) => s + x.allocatedAmount, 0)).toBe(60_000);
  });

  it('sửa khoản có người đã rời nhà: vẫn giữ được người đó; người ngoài thì không thêm được', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const [hung, thien, mai] = users;
    const created = await fx
      .as(hung.token)
      .post(url(houseId), { ...base, totalAmount: 90_000, splitType: 'CUSTOM', participantIds: [hung.id, mai.id] })
      .expect(201);
    await fx.prisma.houseMember.updateMany({ where: { houseId, userId: mai.id }, data: { leftAt: new Date() } });

    const res = await fx.as(hung.token).patch(url(houseId, `/${created.body.id}`), { totalAmount: 80_000 }).expect(200);
    expect(amountsOf(res.body)).toEqual({ [hung.id]: 40_000, [mai.id]: 40_000 });
    // Khoản mới thì Mai không còn là thành viên.
    await fx.as(hung.token).post(url(houseId), { ...base, splitType: 'CUSTOM', participantIds: [mai.id] }).expect(422);
    // Chia đều khoản mới chỉ còn người đang ở.
    const equal = await fx.as(thien.token).post(url(houseId), base).expect(201);
    expect(Object.keys(amountsOf(equal.body)).sort()).toEqual([hung.id, thien.id].sort());
  });

  it('xóa: người khác 403; người trả xóa được, emit expense:deleted, sau đó 404', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const created = await fx.as(users[1].token).post(url(houseId), base).expect(201);
    const id = created.body.id as string;
    await fx.as(users[2].token).delete(url(houseId, `/${id}`)).expect(403);
    const emit = vi.spyOn(fx.app.get(EventsService), 'emitToHouse');
    expect((await fx.as(users[1].token).delete(url(houseId, `/${id}`)).expect(200)).body).toEqual({ ok: true });
    expect(emit).toHaveBeenCalledWith(houseId, 'expense:deleted', { expenseId: id });
    await fx.as(users[1].token).get(url(houseId, `/${id}`)).expect(404);
    expect(await fx.prisma.expenseSplit.count({ where: { expenseId: id } })).toBe(0);
  });

  it('ảnh hóa đơn: tải lên theo thư mục nhà, chỉ nhận URL của chính nhà; đổi/xóa thì dọn ảnh cũ', async () => {
    const a = await fx.houseWith(['Hùng', 'Thiện']);
    const b = await fx.houseWith(['Lan', 'Huệ']);
    const uploadAs = (token: string, houseId: string) =>
      fx.http().post(url(houseId, '/receipt-image')).set('Authorization', `Bearer ${token}`).attach('photo', png(), { filename: 'bill', contentType: 'image/png' });

    const first = await uploadAs(a.users[0].token, a.houseId).expect(201);
    expect(upload).toHaveBeenCalledWith(expect.any(Buffer), `houses/${a.houseId}/receipts`);
    const fromB = await uploadAs(b.users[0].token, b.houseId).expect(201);

    const asHung = fx.as(a.users[0].token);
    expect((await asHung.post(url(a.houseId), { ...base, receiptImageUrl: fromB.body.url }).expect(422)).body.code).toBe('RECEIPT_URL_INVALID');
    expect((await asHung.post(url(a.houseId), { ...base, receiptImageUrl: 'https://evil.example/x.png' }).expect(422)).body.code).toBe(
      'RECEIPT_URL_INVALID',
    );

    const created = await asHung.post(url(a.houseId), { ...base, receiptImageUrl: first.body.url }).expect(201);
    expect(created.body.receiptImageUrl).toBe(first.body.url);

    const second = await uploadAs(a.users[0].token, a.houseId).expect(201);
    await asHung.patch(url(a.houseId, `/${created.body.id}`), { receiptImageUrl: second.body.url }).expect(200);
    expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/receipts\/r\d+$/));

    destroy.mockClear();
    const cleared = await asHung.patch(url(a.houseId, `/${created.body.id}`), { receiptImageUrl: null }).expect(200);
    expect(cleared.body.receiptImageUrl).toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);

    await fx.http().post(url(a.houseId, '/receipt-image')).set('Authorization', `Bearer ${a.users[0].token}`).expect(400);
  });

  it('summary khớp ảnh 07: tổng 2.280.000đ, 6 hóa đơn, Hùng trả 380.000đ, chịu 550.000đ, chênh −170.000đ', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện', 'Mai', 'Quân']);
    const [hung, thien, mai, quan] = users;
    const post = (token: string, body: object) => fx.as(token).post(url(houseId), { ...base, ...body }).expect(201);
    const day = (d: string) => `2026-10-${d}T12:00:00+07:00`;
    await post(mai.token, { title: 'Nước rửa chén & giấy', category: 'SUPPLIES', totalAmount: 120_000, spentAt: day('05') });
    await post(hung.token, { title: 'Bình gas', category: 'OTHER', totalAmount: 380_000, spentAt: day('05') });
    await post(quan.token, {
      title: 'Đi chợ cuối tuần',
      category: 'FOOD',
      totalAmount: 520_000,
      splitType: 'EXACT',
      spentAt: day('04'),
      splits: [
        { userId: hung.id, amount: 110_000 },
        { userId: thien.id, amount: 120_000 },
        { userId: mai.id, amount: 140_000 },
        { userId: quan.id, amount: 150_000 },
      ],
    });
    await post(quan.token, { title: 'Wifi tháng 10', category: 'INTERNET', totalAmount: 240_000, spentAt: day('03') });
    await post(thien.token, { title: 'Tiền nước', category: 'WATER', totalAmount: 180_000, spentAt: day('02') });
    await post(mai.token, { title: 'Tiền điện tháng 10', category: 'ELECTRICITY', totalAmount: 840_000, spentAt: day('01') });
    // Tháng khác không được tính.
    await post(hung.token, { title: 'Tháng 9', totalAmount: 999_000, spentAt: '2026-09-15T12:00:00+07:00' });

    const res = await fx.as(hung.token).get(url(houseId, '/summary?month=2026-10')).expect(200);
    expect(res.body).toEqual({
      month: '2026-10',
      totalAmount: 2_280_000,
      expenseCount: 6,
      participantCount: 4,
      paidByMe: 380_000,
      paidByMeCount: 1,
      myShare: 550_000,
      diff: -170_000,
      byCategory: [
        { category: 'ELECTRICITY', amount: 840_000, count: 1 },
        { category: 'FOOD', amount: 520_000, count: 1 },
        { category: 'OTHER', amount: 380_000, count: 1 },
        { category: 'INTERNET', amount: 240_000, count: 1 },
        { category: 'WATER', amount: 180_000, count: 1 },
        { category: 'SUPPLIES', amount: 120_000, count: 1 },
      ],
    });

    const empty = await fx.as(hung.token).get(url(houseId, '/summary?month=2026-08')).expect(200);
    expect(empty.body).toMatchObject({ totalAmount: 0, expenseCount: 0, participantCount: 0, paidByMe: 0, myShare: 0, diff: 0, byCategory: [] });
    await fx.as(hung.token).get(url(houseId, '/summary?month=10-2026')).expect(400);
    const outsider = await fx.user('Người lạ');
    await fx.as(outsider.token).get(url(houseId, '/summary')).expect(403);
  });
});

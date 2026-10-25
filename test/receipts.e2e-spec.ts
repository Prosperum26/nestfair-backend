import { vi } from 'vitest';
import { vnDayStart } from '../src/common/vn-day.js';
import { ExtractorError, RECEIPT_EXTRACTOR, type RawReceipt } from '../src/modules/receipts/receipt-extractor.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { png } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

describe('Receipts scan (e2e)', () => {
  const upload = vi.fn();
  const destroy = vi.fn();
  const extract = vi.fn();
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let seq = 0;

  beforeAll(async () => {
    fx = await createFixture('@e2e-receipts.nestfair.test', (b) =>
      b
        .overrideProvider(CloudinaryService)
        .useValue({ upload, destroy })
        .overrideProvider(RECEIPT_EXTRACTOR)
        .useValue({ extract }),
    );
  });
  beforeEach(() => {
    upload.mockReset();
    destroy.mockReset();
    extract.mockReset();
    upload.mockImplementation(async (_buf: Buffer, folder: string) => {
      const publicId = 'nestfair/' + folder + '/s' + ++seq;
      return { url: 'https://res.cloudinary.com/demo/image/upload/v1/' + publicId + '.png', publicId };
    });
  });
  afterAll(() => fx.cleanup());

  const url = (houseId: string) => '/api/v1/houses/' + houseId + '/expenses/scan';
  const goodReceipt = (over: Partial<RawReceipt> = {}): RawReceipt => ({
    merchant: 'Bách Hóa Xanh',
    purchasedAt: '2026-10-06',
    items: [
      { name: 'Trứng gà hộp 10', quantity: 1, lineTotal: 32_000 },
      { name: 'Sữa tươi 1L', quantity: 2, lineTotal: 64_000, uncertain: true, note: 'Số lượng bị mờ' },
    ],
    total: 96_000,
    warnings: [],
    ...over,
  });
  const scanAs = (token: string, houseId: string) =>
    fx.http().post(url(houseId)).set('Authorization', 'Bearer ' + token).attach('photo', png(), { filename: 'bill.png', contentType: 'image/png' });

  /** Người dùng đã đồng ý gửi ảnh hóa đơn tới Gemini (D13). */
  const consent = (...users: { id: string }[]) =>
    fx.prisma.user.updateMany({ where: { id: { in: users.map((u) => u.id) } }, data: { ocrConsentAt: new Date() } });

  const seedScans = (houseId: string, userId: string, count: number, createdAt: Date) =>
    fx.prisma.receiptScan.createMany({
      data: Array.from({ length: count }, () => ({ houseId, scannedById: userId, imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/old.png', status: 'FAILED' as const, createdAt })),
    });

  it('ảnh tốt: trả bản nháp, lưu ReceiptScan DRAFT kèm JSON gốc và độ trễ, KHÔNG tạo khoản chi', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    await consent(...users);
    extract.mockResolvedValue(goodReceipt());

    const res = await scanAs(users[0].token, houseId).expect(201);

    expect(res.body).toMatchObject({ mode: 'DRAFT', reason: null, message: null });
    expect(res.body.draft).toMatchObject({ merchant: 'Bách Hóa Xanh', purchasedAt: '2026-10-06', total: 96_000, warnings: [] });
    expect(res.body.draft.items[1]).toMatchObject({ name: 'Sữa tươi 1L', uncertain: true, note: 'Số lượng bị mờ' });
    expect(res.body.imageUrl).toContain('/nestfair/houses/' + houseId + '/receipts/');
    expect(upload).toHaveBeenCalledWith(expect.any(Buffer), 'houses/' + houseId + '/receipts');
    expect(extract).toHaveBeenCalledWith({ buffer: expect.any(Buffer), mimeType: 'image/png' });

    const row = await fx.prisma.receiptScan.findUniqueOrThrow({ where: { id: res.body.scanId } });
    expect(row).toMatchObject({ houseId, scannedById: users[0].id, status: 'DRAFT', failureReason: null, expenseId: null });
    expect(row.draftJson).toMatchObject({ total: 96_000 });
    expect(row.latencyMs).toEqual(expect.any(Number));
    expect(await fx.prisma.expense.count({ where: { houseId } })).toBe(0);
  });

  it('Gemini quá hạn hoặc lỗi → 201 MANUAL với lý do đúng, ảnh vẫn trả về, scan FAILED (không 500)', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    await consent(...users);

    extract.mockRejectedValueOnce(new ExtractorError('AI_TIMEOUT'));
    const timeout = await scanAs(users[0].token, houseId).expect(201);
    expect(timeout.body).toMatchObject({ mode: 'MANUAL', reason: 'AI_TIMEOUT', draft: null });
    expect(timeout.body.message).toMatch(/nhập tay/);
    expect(timeout.body.imageUrl).toContain('/receipts/');
    expect(await fx.prisma.receiptScan.findUniqueOrThrow({ where: { id: timeout.body.scanId } })).toMatchObject({ status: 'FAILED', failureReason: 'AI_TIMEOUT' });

    // Lỗi lạ (không phải ExtractorError) cũng không được thành 500 và không lộ chi tiết.
    extract.mockRejectedValueOnce(new Error('projects/123: API key abc-SECRET invalid'));
    const unknown = await scanAs(users[0].token, houseId).expect(201);
    expect(unknown.body).toMatchObject({ mode: 'MANUAL', reason: 'AI_UNAVAILABLE', draft: null });
    expect(JSON.stringify(unknown.body)).not.toContain('SECRET');
  });

  it('ảnh không phải hóa đơn hoặc không đọc được tổng → MANUAL, bản nháp gốc vẫn được lưu để debug', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    await consent(...users);

    extract.mockResolvedValueOnce(goodReceipt({ items: [], total: 0, warnings: ['Đây là ảnh phong cảnh'] }));
    const notReceipt = await scanAs(users[0].token, houseId).expect(201);
    expect(notReceipt.body).toMatchObject({ mode: 'MANUAL', reason: 'NOT_A_RECEIPT', draft: null });
    const row = await fx.prisma.receiptScan.findUniqueOrThrow({ where: { id: notReceipt.body.scanId } });
    expect(row).toMatchObject({ status: 'FAILED', failureReason: 'NOT_A_RECEIPT' });
    expect(row.draftJson).toMatchObject({ warnings: ['Đây là ảnh phong cảnh'] });

    extract.mockResolvedValueOnce(goodReceipt({ total: 0 }));
    expect((await scanAs(users[0].token, houseId).expect(201)).body).toMatchObject({ mode: 'MANUAL', reason: 'UNREADABLE' });
  });

  it('chưa đồng ý gửi ảnh cho Gemini → 403 OCR_CONSENT_REQUIRED, không upload, không gọi Gemini, không ghi scan; đồng ý rồi mới quét được', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    extract.mockResolvedValue(goodReceipt());

    const blocked = await scanAs(users[0].token, houseId).expect(403);
    expect(blocked.body.code).toBe('OCR_CONSENT_REQUIRED');
    expect(upload).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(await fx.prisma.receiptScan.count({ where: { houseId } })).toBe(0);

    // Thiện đồng ý không kéo theo Hùng.
    await consent(users[1]);
    await scanAs(users[0].token, houseId).expect(403);
    await scanAs(users[1].token, houseId).expect(201);

    // Hùng đồng ý rồi rút lại thì lại bị chặn.
    await consent(users[0]);
    await scanAs(users[0].token, houseId).expect(201);
    await fx.prisma.user.update({ where: { id: users[0].id }, data: { ocrConsentAt: null } });
    await scanAs(users[0].token, houseId).expect(403);
  });

  it('hạn mức 20 lượt / nhà / ngày (giờ VN): lượt 21 bị 429 và không gọi Gemini; hôm qua và nhà khác không tính', async () => {
    const a = await fx.houseWith(['Hùng', 'Thiện']);
    const b = await fx.houseWith(['Lan', 'Huệ']);
    await consent(...a.users, ...b.users);
    extract.mockResolvedValue(goodReceipt());
    const yesterday = new Date(vnDayStart(new Date()).getTime() - 60 * 60 * 1000);
    await seedScans(a.houseId, a.users[0].id, 20, yesterday);
    await seedScans(b.houseId, b.users[0].id, 20, new Date());
    await seedScans(a.houseId, a.users[0].id, 19, new Date());

    // Lượt thứ 20 của hôm nay còn được.
    await scanAs(a.users[1].token, a.houseId).expect(201);
    expect(extract).toHaveBeenCalledTimes(1);
    upload.mockClear();

    const over = await scanAs(a.users[1].token, a.houseId).expect(429);
    expect(over.body.code).toBe('OCR_QUOTA_EXCEEDED');
    expect(over.body.message).toContain('20');
    expect(extract).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();

    // Nhà B đã đủ 20 từ trước.
    await scanAs(b.users[1].token, b.houseId).expect(429);
  });

  it('lượt quét lỗi (FAILED) vẫn tính vào hạn mức', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    await consent(...users);
    await seedScans(houseId, users[0].id, 20, new Date());
    expect((await scanAs(users[0].token, houseId).expect(429)).body.code).toBe('OCR_QUOTA_EXCEEDED');
  });

  it('quyền và dữ liệu vào: người ngoài nhà 403, không JWT 401, thiếu file 400, file giả ảnh 415; nhà lấy từ membership', async () => {
    const a = await fx.houseWith(['Hùng', 'Thiện']);
    const b = await fx.houseWith(['Lan', 'Huệ']);
    await consent(...a.users, ...b.users);
    extract.mockResolvedValue(goodReceipt());

    await fx.http().post(url(a.houseId)).attach('photo', png(), { filename: 'bill.png', contentType: 'image/png' }).expect(401);
    // Hùng (nhà A) quét vào URL của nhà B: bị chặn, không ghi scan nào cho nhà B.
    await scanAs(a.users[0].token, b.houseId).expect(403);
    expect(await fx.prisma.receiptScan.count({ where: { houseId: b.houseId } })).toBe(0);

    const auth = 'Bearer ' + a.users[0].token;
    await fx.http().post(url(a.houseId)).set('Authorization', auth).expect(400);
    const fake = await fx.http().post(url(a.houseId)).set('Authorization', auth).attach('photo', Buffer.from('khong phai anh'), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(415);
    expect(fake.body.code).toBe('UNSUPPORTED_IMAGE');
    expect(extract).not.toHaveBeenCalled();
  });
});

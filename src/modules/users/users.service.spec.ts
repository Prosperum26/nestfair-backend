import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

const userId = '11111111-1111-1111-1111-111111111111';
const current = {
  id: userId,
  email: 'hung@uit.edu.vn',
  fullName: 'Trần Minh Hùng',
  phone: '0901234567',
  bankBin: null as string | null,
  bankAccount: null as string | null,
  avatarUrl: null,
  ocrConsentAt: null as Date | null,
  createdAt: new Date('2026-10-08T00:00:00Z'),
};

describe('UsersService', () => {
  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(current),
        update: vi
          .fn()
          .mockImplementation(({ data }) => ({ ...current, ...data })),
      },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  it('getMe: user không còn tồn tại thì 401', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getMe(userId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('chỉ cập nhật field có gửi, select cột công khai', async () => {
    await service.updateMe(userId, { fullName: 'Hùng' });

    const args = prisma.user.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: userId });
    expect(args.data).toEqual({ fullName: 'Hùng' });
    expect(args.select.passwordHash).toBeUndefined();
  });

  it('lưu ngân hàng khi gửi đủ bankBin + bankAccount', async () => {
    const user = await service.updateMe(userId, {
      bankBin: '970407',
      bankAccount: '19036780123',
    });
    expect(user).toMatchObject({
      bankBin: '970407',
      bankAccount: '19036780123',
    });
  });

  it('đổi riêng số tài khoản khi đã có ngân hàng thì được', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...current,
      bankBin: '970407',
      bankAccount: '111111',
    });
    await service.updateMe(userId, { bankAccount: '222222' });
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      bankAccount: '222222',
    });
  });

  it('xóa cả hai bằng null thì được', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...current,
      bankBin: '970407',
      bankAccount: '111111',
    });
    await service.updateMe(userId, { bankBin: null, bankAccount: null });
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      bankBin: null,
      bankAccount: null,
    });
  });

  it.each([
    ['chỉ có ngân hàng, thiếu STK', { bankBin: '970407' }, {}],
    ['chỉ có STK, thiếu ngân hàng', { bankAccount: '19036780123' }, {}],
    [
      'xóa ngân hàng nhưng giữ STK',
      { bankBin: null },
      { bankBin: '970407', bankAccount: '111111' },
    ],
  ])('%s thì 400, không ghi DB', async (_, dto, existing) => {
    prisma.user.findUnique.mockResolvedValue({ ...current, ...existing });

    await expect(service.updateMe(userId, dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  describe('setOcrConsent (đồng ý gửi ảnh hóa đơn tới Gemini)', () => {
    const now = new Date('2026-10-20T03:00:00Z');

    it('đồng ý: ghi mốc đồng ý, chỉ select cột công khai', async () => {
      const result = await service.setOcrConsent(userId, true, now);

      const args = prisma.user.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: userId });
      expect(args.data).toEqual({ ocrConsentAt: now });
      expect(args.select).toBeDefined();
      expect(result.ocrConsentAt).toEqual(now);
    });

    it('đồng ý lần hai thì giữ mốc đầu tiên, không ghi lại', async () => {
      const first = new Date('2026-10-01T00:00:00Z');
      prisma.user.findUnique.mockResolvedValue({ ...current, ocrConsentAt: first });

      const result = await service.setOcrConsent(userId, true, now);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(result.ocrConsentAt).toEqual(first);
    });

    it('tắt: xóa mốc đồng ý (null)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...current, ocrConsentAt: now });

      const result = await service.setOcrConsent(userId, false, now);

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ ocrConsentAt: null });
      expect(result.ocrConsentAt).toBeNull();
    });

    it('tắt khi chưa đồng ý thì không ghi gì', async () => {
      await service.setOcrConsent(userId, false, now);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('user không còn tồn tại thì 401', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.setOcrConsent(userId, true, now)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});

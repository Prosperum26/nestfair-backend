import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const userId = '11111111-1111-1111-1111-111111111111';

describe('AuthService.changePassword', () => {
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    refreshToken: { updateMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let service: AuthService;
  let hash: string;

  beforeAll(async () => {
    hash = await bcrypt.hash('MatKhauCu1', 4);
  });

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ passwordHash: hash }),
        update: vi.fn().mockResolvedValue({}),
      },
      refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    const config = { get: () => 15 } as unknown as ConfigService;
    service = new AuthService(prisma as unknown as PrismaService, new JwtService({ secret: 'x'.repeat(64) }), config as never);
  });

  const dto = { currentPassword: 'MatKhauCu1', newPassword: 'MatKhauMoi2' };

  it('đúng mật khẩu cũ: lưu hash mới (bcrypt), thu hồi mọi phiên khác trừ phiên hiện tại', async () => {
    await service.changePassword(userId, dto, 'raw-current-token');

    const saved = prisma.user.update.mock.calls[0][0];
    expect(saved.where).toEqual({ id: userId });
    expect(await bcrypt.compare('MatKhauMoi2', saved.data.passwordHash)).toBe(true);

    const revoke = prisma.refreshToken.updateMany.mock.calls[0][0];
    expect(revoke.where).toEqual({ userId, revokedAt: null, tokenHash: { not: sha256('raw-current-token') } });
    expect(revoke.data.revokedAt).toBeInstanceOf(Date);
  });

  it('không có cookie phiên thì thu hồi tất cả', async () => {
    await service.changePassword(userId, dto, undefined);
    expect(prisma.refreshToken.updateMany.mock.calls[0][0].where).toEqual({ userId, revokedAt: null });
  });

  it('sai mật khẩu cũ thì 400 WRONG_PASSWORD (không phải 401), không ghi gì', async () => {
    await expect(service.changePassword(userId, { ...dto, currentPassword: 'Sai12345' }, 't')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'WRONG_PASSWORD' }),
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('mật khẩu mới trùng mật khẩu cũ thì 400 SAME_PASSWORD', async () => {
    await expect(service.changePassword(userId, { currentPassword: 'MatKhauCu1', newPassword: 'MatKhauCu1' }, 't')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'SAME_PASSWORD' }),
    });
  });

  it('tài khoản chỉ đăng nhập Google (passwordHash null) thì 400 PASSWORD_NOT_SET', async () => {
    prisma.user.findUnique.mockResolvedValue({ passwordHash: null });
    await expect(service.changePassword(userId, dto, 't')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'PASSWORD_NOT_SET' }),
    });
  });

  it('user không còn tồn tại thì 401', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.changePassword(userId, dto, 't')).rejects.toMatchObject({ status: 401 });
  });
});

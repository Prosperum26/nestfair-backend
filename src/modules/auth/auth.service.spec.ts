import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

const SECRET = 'x'.repeat(64);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const publicUser = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'hung@uit.edu.vn',
  fullName: 'Trần Minh Hùng',
  phone: '0901234567',
  bankBin: null,
  bankAccount: null,
  avatarUrl: null,
  createdAt: new Date('2026-10-08T00:00:00Z'),
};

function createPrismaMock() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    refreshToken: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  return prisma;
}

describe('AuthService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let jwt: JwtService;
  let service: AuthService;

  beforeEach(() => {
    prisma = createPrismaMock();
    jwt = new JwtService({ secret: SECRET });
    const config = {
      get: (key: string) =>
        ({ JWT_ACCESS_TTL_MINUTES: 15, REFRESH_TOKEN_TTL_DAYS: 7 })[key],
    } as unknown as ConfigService;
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt,
      config as never,
    );
  });

  describe('register', () => {
    const dto = {
      fullName: 'Trần Minh Hùng',
      email: 'hung@uit.edu.vn',
      phone: '0901234567',
      password: 'MatKhau123',
    };

    it('băm mật khẩu bằng bcrypt cost 10, không lưu plaintext', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(publicUser);

      await service.register(dto);

      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data.passwordHash).not.toBe(dto.password);
      expect(data.passwordHash).toMatch(/^\$2b\$10\$/);
      await expect(
        bcrypt.compare(dto.password, data.passwordHash),
      ).resolves.toBe(true);
    });

    it('chỉ select các cột công khai khi tạo user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(publicUser);

      const session = await service.register(dto);

      const select = prisma.user.create.mock.calls[0][0].select;
      expect(select.passwordHash).toBeUndefined();
      expect(select.googleId).toBeUndefined();
      expect(session.user).not.toHaveProperty('passwordHash');
    });

    it('trả access token có sub = userId và refresh token mới', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(publicUser);

      const session = await service.register(dto);

      const payload = await jwt.verifyAsync(session.accessToken);
      expect(payload.sub).toBe(publicUser.id);
      expect(session.refreshToken).toHaveLength(43); // 32 byte base64url
      expect(session.persistent).toBe(true);
    });

    it('chỉ lưu hash SHA-256 của refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(publicUser);

      const session = await service.register(dto);

      const data = prisma.refreshToken.create.mock.calls[0][0].data;
      expect(data.tokenHash).toBe(sha256(session.refreshToken));
      expect(data.tokenHash).not.toBe(session.refreshToken);
    });

    it('email đã tồn tại thì 409', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'other' });

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('hai request đăng ký trùng email cùng lúc: unique constraint vẫn ra 409', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.register(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('login', () => {
    let passwordHash: string;
    beforeAll(async () => {
      passwordHash = await bcrypt.hash('MatKhau123', 10);
    });

    it('đúng email + mật khẩu thì cấp phiên, không trả passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...publicUser, passwordHash });

      const session = await service.login({
        email: publicUser.email,
        password: 'MatKhau123',
      });

      expect(session.user).toEqual(publicUser);
      expect(session.user).not.toHaveProperty('passwordHash');
      expect(session.persistent).toBe(true);
    });

    it('rememberMe = false thì phiên không persistent', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...publicUser, passwordHash });

      const session = await service.login({
        email: publicUser.email,
        password: 'MatKhau123',
        rememberMe: false,
      });

      expect(session.persistent).toBe(false);
      expect(prisma.refreshToken.create.mock.calls[0][0].data.persistent).toBe(
        false,
      );
    });

    it.each([
      ['sai mật khẩu', () => ({ ...publicUser, passwordHash })],
      ['email không tồn tại', () => null],
      [
        'tài khoản chỉ có Google (không có mật khẩu)',
        () => ({ ...publicUser, passwordHash: null }),
      ],
    ])('%s thì 401 với cùng một thông báo', async (_, user) => {
      prisma.user.findUnique.mockResolvedValue(user());

      const error = await service
        .login({ email: publicUser.email, password: 'SaiMatKhau1' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as Error).message).toBe('Email hoặc mật khẩu không đúng.');
    });
  });

  describe('refresh', () => {
    const raw = 'raw-refresh-token';
    const stored = (over: Record<string, unknown> = {}) => ({
      id: 'rt-1',
      userId: publicUser.id,
      tokenHash: sha256(raw),
      persistent: false,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: publicUser,
      ...over,
    });

    it('token hợp lệ: thu hồi token cũ, cấp token mới, giữ lựa chọn persistent', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(stored());

      const session = await service.refresh(raw);

      expect(prisma.refreshToken.findUnique.mock.calls[0][0].where).toEqual({
        tokenHash: sha256(raw),
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(session.refreshToken).not.toBe(raw);
      expect(session.persistent).toBe(false);
      expect(session.user).toEqual(publicUser);
    });

    it.each<[string, string | undefined, () => unknown]>([
      ['không có cookie', undefined, () => null],
      ['token không tồn tại', raw, () => null],
      [
        'token đã bị thu hồi (dùng lại token cũ)',
        raw,
        () => stored({ revokedAt: new Date() }),
      ],
      [
        'token hết hạn',
        raw,
        () => stored({ expiresAt: new Date(Date.now() - 1) }),
      ],
    ])('%s thì 401', async (_, token, found) => {
      prisma.refreshToken.findUnique.mockResolvedValue(found());

      await expect(service.refresh(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('hai lần refresh đồng thời cùng token: lần thua nhận 401', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(stored());
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.refresh(raw)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('thu hồi refresh token đang dùng', async () => {
      await service.logout('raw');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: sha256('raw'), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('không có cookie thì bỏ qua, không lỗi', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('loginWithGoogle', () => {
    const profile = {
      googleId: 'g-123',
      email: 'hung@uit.edu.vn',
      emailVerified: true,
      fullName: 'Trần Minh Hùng',
      avatarUrl: 'https://lh3.googleusercontent.com/a/x',
    };

    it('đã liên kết googleId thì đăng nhập luôn, không sửa gì', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(publicUser);

      const session = await service.loginWithGoogle(profile);

      expect(prisma.user.findUnique.mock.calls[0][0].where).toEqual({
        googleId: 'g-123',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(session.user).toEqual(publicUser);
      expect(session.persistent).toBe(true);
    });

    it('email đã có tài khoản mật khẩu thì liên kết googleId vào tài khoản đó', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // theo googleId
        .mockResolvedValueOnce({ id: publicUser.id, avatarUrl: null }); // theo email
      prisma.user.update.mockResolvedValue(publicUser);

      await service.loginWithGoogle(profile);

      expect(prisma.user.findUnique.mock.calls[1][0].where).toEqual({
        email: 'hung@uit.edu.vn',
      });
      const args = prisma.user.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: publicUser.id });
      expect(args.data).toEqual({
        googleId: 'g-123',
        avatarUrl: profile.avatarUrl,
      });
      expect(args.select.passwordHash).toBeUndefined();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('liên kết không ghi đè avatar người dùng đã có', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: publicUser.id,
          avatarUrl: 'https://res.cloudinary.com/a.png',
        });
      prisma.user.update.mockResolvedValue(publicUser);

      await service.loginWithGoogle(profile);

      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        googleId: 'g-123',
      });
    });

    it('chưa có tài khoản thì tạo mới, không có mật khẩu', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(publicUser);

      await service.loginWithGoogle({ ...profile, email: 'HUNG@UIT.EDU.VN' });

      expect(prisma.user.create.mock.calls[0][0].data).toEqual({
        email: 'hung@uit.edu.vn',
        googleId: 'g-123',
        fullName: 'Trần Minh Hùng',
        avatarUrl: profile.avatarUrl,
      });
    });

    it('email Google chưa xác minh thì 401, không liên kết', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.loginWithGoogle({ ...profile, emailVerified: false }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('Google không trả email thì 401', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.loginWithGoogle({ ...profile, email: undefined }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('me', () => {
    it('trả user công khai', async () => {
      prisma.user.findUnique.mockResolvedValue(publicUser);

      await expect(service.me(publicUser.id)).resolves.toEqual(publicUser);
    });

    it('user đã bị xóa thì 401', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.me(publicUser.id)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});

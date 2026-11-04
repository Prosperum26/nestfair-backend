import { UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CloudinaryService } from '../uploads/cloudinary.service.js';
import { UsersService } from './users.service.js';

const userId = '11111111-1111-1111-1111-111111111111';
const OLD_URL = `https://res.cloudinary.com/demo/image/upload/v1/nestfair/users/${userId}/avatar/old1.jpg`;
const NEW_URL = `https://res.cloudinary.com/demo/image/upload/v2/nestfair/users/${userId}/avatar/new2.jpg`;
const current = {
  id: userId,
  email: 'hung@uit.edu.vn',
  fullName: 'Trần Minh Hùng',
  phone: null,
  bankBin: null,
  bankAccount: null,
  avatarUrl: null as string | null,
  notificationPrefs: null as unknown,
  ocrConsentAt: null,
  assistantConsentAt: null,
  createdAt: new Date('2026-10-08T00:00:00Z'),
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const jpegFile = { buffer: JPEG, mimetype: 'image/jpeg', size: JPEG.length };

describe('UsersService: thông báo và avatar', () => {
  let prisma: { user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } };
  let cloud: { upload: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(current),
        update: vi.fn().mockImplementation(({ data }) => ({ ...current, ...data })),
      },
    };
    cloud = {
      upload: vi.fn().mockResolvedValue({ url: NEW_URL, publicId: 'nestfair/users/x/avatar/new2' }),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    service = new UsersService(prisma as unknown as PrismaService, cloud as unknown as CloudinaryService);
  });

  describe('setNotificationPrefs', () => {
    it('chưa có gì: ghi cả 3 khóa, key không gửi lấy mặc định bật', async () => {
      await service.setNotificationPrefs(userId, { choreDigest: false });
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        notificationPrefs: { expenseCreated: true, choreDigest: false, debtPaid: true },
      });
    });

    it('gộp với giá trị đã lưu, không đè khóa khác', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...current, notificationPrefs: { debtPaid: false } });
      await service.setNotificationPrefs(userId, { expenseCreated: false });
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        notificationPrefs: { expenseCreated: false, choreDigest: true, debtPaid: false },
      });
    });

    it('user không còn tồn tại thì 401', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.setNotificationPrefs(userId, { debtPaid: false })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('setAvatar', () => {
    it('không có file thì 400 AVATAR_REQUIRED, không upload', async () => {
      await expect(service.setAvatar(userId, undefined)).rejects.toMatchObject({
        response: expect.objectContaining({ statusCode: 400, code: 'AVATAR_REQUIRED' }),
      });
      expect(cloud.upload).not.toHaveBeenCalled();
    });

    it('sai định dạng thì 415, không upload', async () => {
      const bad = { buffer: Buffer.from('GIF89a'), mimetype: 'image/gif', size: 6 };
      await expect(service.setAvatar(userId, bad)).rejects.toMatchObject({ status: 415 });
      expect(cloud.upload).not.toHaveBeenCalled();
    });

    it('lần đầu: upload vào thư mục của user, lưu URL, không xóa gì', async () => {
      const result = await service.setAvatar(userId, jpegFile);
      expect(cloud.upload).toHaveBeenCalledWith(JPEG, `users/${userId}/avatar`);
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ avatarUrl: NEW_URL });
      expect(result.avatarUrl).toBe(NEW_URL);
      expect(cloud.destroy).not.toHaveBeenCalled();
    });

    it('đổi ảnh: xóa ảnh cũ trên Cloudinary SAU khi lưu URL mới', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...current, avatarUrl: OLD_URL });
      await service.setAvatar(userId, jpegFile);
      expect(cloud.destroy).toHaveBeenCalledWith(`nestfair/users/${userId}/avatar/old1`);
      expect(prisma.user.update.mock.invocationCallOrder[0]).toBeLessThan(cloud.destroy.mock.invocationCallOrder[0]);
    });

    it('avatar cũ không phải URL Cloudinary (vd. Google) thì không xóa gì', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...current, avatarUrl: 'https://lh3.googleusercontent.com/a/abc' });
      await service.setAvatar(userId, jpegFile);
      expect(cloud.destroy).not.toHaveBeenCalled();
    });

    it('lưu DB lỗi thì dọn ảnh vừa upload rồi ném lại lỗi', async () => {
      prisma.user.update.mockRejectedValue(new Error('db down'));
      await expect(service.setAvatar(userId, jpegFile)).rejects.toThrow('db down');
      expect(cloud.destroy).toHaveBeenCalledWith('nestfair/users/x/avatar/new2');
    });
  });

  describe('removeAvatar', () => {
    it('xóa URL rồi xóa ảnh trên Cloudinary', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...current, avatarUrl: OLD_URL });
      const result = await service.removeAvatar(userId);
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ avatarUrl: null });
      expect(cloud.destroy).toHaveBeenCalledWith(`nestfair/users/${userId}/avatar/old1`);
      expect(result.avatarUrl).toBeNull();
    });

    it('chưa có avatar thì không ghi gì', async () => {
      await service.removeAvatar(userId);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(cloud.destroy).not.toHaveBeenCalled();
    });
  });
});

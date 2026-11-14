import {
  BadRequestException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CloudinaryService, publicIdFromUrl } from '../uploads/cloudinary.service.js';
import { type UploadedImage, validateImageFile } from '../uploads/image-validation.js';
import type { UpdateNotificationPrefsDto } from './dto/update-notification-prefs.dto.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import { resolveNotificationPrefs } from './notification-prefs.js';
import { type PublicUser, publicUserSelect } from './public-user.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect,
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  async updateMe(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
    const current = await this.getMe(userId);

    // Ngân hàng và STK đi theo cặp: sau khi cập nhật phải cùng có hoặc cùng trống,
    // nếu không VietQR sẽ sinh sai.
    const bankBin = dto.bankBin === undefined ? current.bankBin : dto.bankBin;
    const bankAccount =
      dto.bankAccount === undefined ? current.bankAccount : dto.bankAccount;
    if (!bankBin !== !bankAccount) {
      throw new BadRequestException(
        'Cần chọn ngân hàng và nhập số tài khoản cùng lúc.',
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: publicUserSelect,
    });
  }

  /** Gộp công tắc gửi lên vào giá trị đã lưu; khóa không gửi giữ nguyên (chưa có thì bật). */
  async setNotificationPrefs(userId: string, dto: UpdateNotificationPrefsDto): Promise<PublicUser> {
    const current = await this.getMe(userId);
    const next = { ...resolveNotificationPrefs(current.notificationPrefs) };
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (dto[key] !== undefined) next[key] = dto[key];
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { notificationPrefs: next },
      select: publicUserSelect,
    });
  }

  /**
   * Đổi ảnh đại diện. Lưu URL mới trước, xóa ảnh cũ sau để lỗi giữa chừng không làm mất avatar đang dùng;
   * lưu DB lỗi thì dọn ảnh vừa upload. Avatar cũ không thuộc Cloudinary (vd. ảnh Google) thì để nguyên.
   */
  async setAvatar(userId: string, file: UploadedImage | undefined): Promise<PublicUser> {
    if (!file) throw coded(HttpStatus.BAD_REQUEST, 'AVATAR_REQUIRED', 'Hãy chọn ảnh đại diện.');
    validateImageFile(file);
    const current = await this.getMe(userId);

    const uploaded = await this.cloudinary.upload(file.buffer, `users/${userId}/avatar`);
    let user: PublicUser;
    try {
      user = await this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: uploaded.url },
        select: publicUserSelect,
      });
    } catch (error) {
      await this.cloudinary.destroy(uploaded.publicId);
      throw error;
    }
    await this.destroyAvatarFile(current.avatarUrl);
    return user;
  }

  async removeAvatar(userId: string): Promise<PublicUser> {
    const current = await this.getMe(userId);
    if (!current.avatarUrl) return current;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
      select: publicUserSelect,
    });
    await this.destroyAvatarFile(current.avatarUrl);
    return user;
  }

  private async destroyAvatarFile(url: string | null): Promise<void> {
    const publicId = url ? publicIdFromUrl(url) : null;
    if (publicId) await this.cloudinary.destroy(publicId);
  }

  /**
   * Đồng ý (hoặc rút lại) việc gửi ảnh hóa đơn tới Google Gemini. Đồng ý lần nữa giữ nguyên mốc đầu tiên;
   * tắt khi chưa đồng ý thì không ghi gì.
   */
  async setOcrConsent(
    userId: string,
    enabled: boolean,
    now = new Date(),
  ): Promise<PublicUser> {
    const current = await this.getMe(userId);
    if (enabled === (current.ocrConsentAt !== null)) return current;

    return this.prisma.user.update({
      where: { id: userId },
      data: { ocrConsentAt: enabled ? now : null },
      select: publicUserSelect,
    });
  }

  /**
   * Đồng ý (hoặc rút lại) việc chat với Trợ lý AI (Gemini). Riêng biệt với OCR:
   * bật/tắt mốc này không đụng ocrConsentAt. Đồng ý lần nữa giữ nguyên mốc đầu tiên;
   * tắt thì xóa mốc; tắt khi chưa đồng ý thì không ghi gì.
   */
  async setAssistantConsent(
    userId: string,
    enabled: boolean,
    now = new Date(),
  ): Promise<PublicUser> {
    const current = await this.getMe(userId);
    if (enabled === (current.assistantConsentAt !== null)) return current;

    return this.prisma.user.update({
      where: { id: userId },
      data: { assistantConsentAt: enabled ? now : null },
      select: publicUserSelect,
    });
  }
}

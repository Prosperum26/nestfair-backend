import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { UpdateProfileDto } from './dto/update-profile.dto.js';
import { type PublicUser, publicUserSelect } from './public-user.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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

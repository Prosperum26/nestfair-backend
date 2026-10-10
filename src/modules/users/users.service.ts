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
}

import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { HouseRole } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { AuthUser } from '../../auth/strategies/jwt.strategy.js';

/** Membership đã xác thực, gắn vào request bởi HouseMemberGuard. */
export interface HouseMembership {
  id: string;
  houseId: string;
  userId: string;
  role: HouseRole;
}

declare module 'express' {
  interface Request {
    membership?: HouseMembership;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dùng cho mọi route `/houses/:houseId/...`, đặt sau JwtAuthGuard:
 *   @UseGuards(JwtAuthGuard, HouseMemberGuard)
 * Chỉ cho qua khi user đang là thành viên (leftAt = null) của đúng nhà trong URL,
 * rồi gắn membership vào request. Service lấy houseId từ @CurrentMembership(),
 * không lấy từ body/query (chống IDOR).
 */
@Injectable()
export class HouseMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as AuthUser | undefined;
    const houseId = req.params.houseId;
    if (!user) throw new ForbiddenException();
    if (typeof houseId !== 'string' || !UUID.test(houseId)) {
      throw new NotFoundException('Không tìm thấy nhà.');
    }

    const membership = await this.prisma.houseMember.findFirst({
      where: { houseId, userId: user.id, leftAt: null },
      select: { id: true, houseId: true, userId: true, role: true },
    });
    if (!membership) {
      throw new ForbiddenException('Bạn không phải thành viên nhà này.');
    }
    req.membership = membership;
    return true;
  }
}

import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { HouseRole } from '../../../generated/prisma/enums.js';

const ROLES_KEY = 'houseRoles';

/** Giới hạn route theo vai trò trong nhà. Dùng cùng HouseRolesGuard, sau HouseMemberGuard. */
export const HouseRoles = (...roles: HouseRole[]) =>
  SetMetadata(ROLES_KEY, roles);

/**
 *   @HouseRoles('ADMIN')
 *   @UseGuards(JwtAuthGuard, HouseMemberGuard, HouseRolesGuard)
 */
@Injectable()
export class HouseRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<HouseRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;

    const { membership } = context.switchToHttp().getRequest<Request>();
    if (!membership || !roles.includes(membership.role)) {
      throw new ForbiddenException('Chỉ trưởng phòng mới làm được việc này.');
    }
    return true;
  }
}

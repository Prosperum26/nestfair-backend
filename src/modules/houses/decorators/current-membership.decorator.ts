import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { HouseMembership } from '../guards/house-member.guard.js';

/** Membership đã xác thực của user trong nhà ở URL. Chỉ dùng trên route có HouseMemberGuard. */
export const CurrentMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): HouseMembership =>
    ctx.switchToHttp().getRequest<Request>().membership!,
);

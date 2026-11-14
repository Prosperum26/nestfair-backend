import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { coded } from '../../../common/coded-exception.js';
import type { Env } from '../../../config/env.validation.js';
import { isAllowedOrigin, parseOrigins } from '../../../config/origins.js';
import { securityLog } from '../../../common/security-log.js';

/**
 * Chống CSRF cho route xác thực bằng cookie (refresh, logout). Trình duyệt luôn gửi `Origin` với POST
 * cross-site, nên có Origin mà không thuộc CORS_ORIGINS là request do trang lạ dựng ra → 403.
 * Không có Origin (curl, app di động, test) thì cho qua: trang web không gửi được request thiếu Origin.
 */
@Injectable()
export class TrustedOriginGuard implements CanActivate {
  private readonly allowed: string[];

  constructor(config: ConfigService<Env, true>) {
    this.allowed = parseOrigins(config.get('CORS_ORIGINS', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    if (origin === undefined || isAllowedOrigin(origin, this.allowed)) return true;
    securityLog.warn(`Chặn origin lạ ${JSON.stringify(origin.slice(0, 100))} tại ${req.path} từ IP ${req.ip}`);
    throw coded(HttpStatus.FORBIDDEN, 'ORIGIN_NOT_ALLOWED', 'Yêu cầu không đến từ trang NestFair.');
  }
}

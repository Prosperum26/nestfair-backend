import {
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { CookieOptions, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { Env } from '../../../config/env.validation.js';
import { isGoogleEnabled } from '../strategies/google.strategy.js';

/** Cookie giữ tham số `state` OAuth (chống login CSRF), chỉ sống trong luồng đăng nhập Google. */
export const OAUTH_STATE_COOKIE = 'nf_oauth_state';

function stateCookieOptions(config: ConfigService<Env, true>): CookieOptions {
  return {
    httpOnly: true,
    secure: config.get('NODE_ENV', { infer: true }) === 'production',
    // Google chuyển hướng về callback bằng GET top-level: sameSite=lax vẫn gửi cookie.
    sameSite: 'lax',
    path: '/api/v1/auth/google',
    maxAge: 10 * 60 * 1000,
  };
}

/** GET /auth/google: sinh state, lưu cookie, passport chuyển hướng sang Google. */
@Injectable()
export class GoogleStartGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!isGoogleEnabled(this.config)) throw new NotFoundException();
    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const state = randomBytes(16).toString('base64url');
    context
      .switchToHttp()
      .getResponse<Response>()
      .cookie(OAUTH_STATE_COOKIE, state, stateCookieOptions(this.config));
    return { state, prompt: 'select_account' };
  }
}

/**
 * GET /auth/google/callback: kiểm tra state rồi để passport đổi code lấy profile.
 * Không ném lỗi: thất bại thì req.user = undefined để controller chuyển hướng
 * về trang web kèm ?error= thay vì trả JSON lỗi giữa chừng.
 */
@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigService<Env, true>) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    if (!isGoogleEnabled(this.config)) throw new NotFoundException();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const expected: unknown = req.cookies?.[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, {
      ...stateCookieOptions(this.config),
      maxAge: undefined,
    });

    const stateOk =
      typeof expected === 'string' &&
      expected.length > 0 &&
      req.query.state === expected;
    if (req.query.error || !stateOk) {
      req.user = undefined;
      return true;
    }
    try {
      return (await super.canActivate(context)) as boolean;
    } catch {
      req.user = undefined;
      return true;
    }
  }

  handleRequest<TUser>(err: unknown, user: TUser): TUser | undefined {
    return err || !user ? undefined : user;
  }
}

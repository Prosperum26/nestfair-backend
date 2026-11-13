import type { CookieOptions } from 'express';
import type { Env } from '../../config/env.validation.js';

export const REFRESH_COOKIE = 'nf_rt';
// Cookie chỉ được gửi kèm các route /auth, không đi theo mọi request API.
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export type SameSite = 'lax' | 'strict' | 'none';

/**
 * Thuộc tính cookie refresh. Mặc định production = `none` (FE trên Pages, BE trên Render khác site);
 * khi cả hai cùng tên miền (app.x và api.x) đặt COOKIE_SAME_SITE=lax để trình duyệt tự chặn CSRF.
 */
export function refreshCookieOptions(nodeEnv: Env['NODE_ENV'], sameSite?: SameSite): CookieOptions {
  const production = nodeEnv === 'production';
  const site = sameSite ?? (production ? 'none' : 'lax');
  return {
    httpOnly: true,
    secure: production || site === 'none',
    sameSite: site,
    path: REFRESH_COOKIE_PATH,
  };
}

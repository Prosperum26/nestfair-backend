import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { type Profile, Strategy } from 'passport-google-oauth20';
import type { Env } from '../../../config/env.validation.js';
import type { GoogleProfile } from '../auth.service.js';

/** Google OAuth chỉ bật khi .env có đủ client id + secret. */
export function isGoogleEnabled(config: ConfigService<Env, true>): boolean {
  return Boolean(
    config.get('GOOGLE_CLIENT_ID', { infer: true }) &&
    config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
  );
}

/** Không đăng ký qua DI trực tiếp: AuthModule chỉ khởi tạo khi isGoogleEnabled. */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<Env, true>) {
    super({
      clientID: config.get('GOOGLE_CLIENT_ID', { infer: true })!,
      clientSecret: config.get('GOOGLE_CLIENT_SECRET', { infer: true })!,
      callbackURL:
        config.get('GOOGLE_CALLBACK_URL', { infer: true }) ??
        `http://localhost:${config.get('PORT', { infer: true })}/api/v1/auth/google/callback`,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): GoogleProfile {
    const email = profile.emails?.[0];
    return {
      googleId: profile.id,
      email: email?.value,
      emailVerified: email?.verified === true,
      fullName: profile.displayName,
      avatarUrl: profile.photos?.[0]?.value,
    };
  }
}

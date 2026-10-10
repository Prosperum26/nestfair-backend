import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import {
  GoogleCallbackGuard,
  GoogleStartGuard,
} from './guards/google-auth.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import {
  GoogleStrategy,
  isGoogleEnabled,
} from './strategies/google.strategy.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    GoogleStartGuard,
    GoogleCallbackGuard,
    {
      // Chưa có key thì không tạo strategy (passport-google-oauth20 ném lỗi khi thiếu clientID).
      provide: GoogleStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        isGoogleEnabled(config) ? new GoogleStrategy(config) : null,
    },
  ],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}

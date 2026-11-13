import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { THROTTLE_AUTH } from '../../common/throttle/throttle.config.js';
import type { Env } from '../../config/env.validation.js';
import { EventsService } from '../events/events.service.js';
import {
  AuthService,
  type GoogleProfile,
  type Session,
} from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import {
  AuthConfigDto,
  AuthResponseDto,
  PublicUserDto,
} from './dto/auth-response.dto.js';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import {
  GoogleCallbackGuard,
  GoogleStartGuard,
} from './guards/google-auth.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { isGoogleEnabled } from './strategies/google.strategy.js';
import type { AuthUser } from './strategies/jwt.strategy.js';

export const REFRESH_COOKIE = 'nf_rt';
// Cookie chỉ được gửi kèm các route /auth, không đi theo mọi request API.
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly events: EventsService,
  ) {}

  @Post('register')
  @Throttle(THROTTLE_AUTH.register)
  @ApiOperation({
    summary: 'Register with email and password',
    description:
      'Creates a new account and signs the user in immediately. The password is stored as a bcrypt hash. ' +
      'The response contains a 15-minute access token and the public user profile; a 7-day refresh token is set as the ' +
      'httpOnly cookie `nf_rt` (path `/api/v1/auth`). The email is trimmed and lower-cased, the phone number must be a ' +
      'Vietnamese 10-digit number starting with 0, and the password needs 8-72 characters with at least one upper-case ' +
      'letter and one digit. No authentication required.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto, description: 'Account created and signed in.' })
  @ApiErrors(400, [409, 'The email address is already registered. The body has no `code`; the message asks whether the user wants to sign in instead.'], [429, 'Too many registrations from this client (5 per minute).'])
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    return this.respond(res, await this.auth.register(dto));
  }

  @Post('login')
  @Throttle(THROTTLE_AUTH.login)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      'Verifies the credentials and starts a session. Returns a 15-minute access token and the user profile, and sets the ' +
      'rotating refresh cookie `nf_rt`. With `rememberMe: false` the cookie is a browser-session cookie that disappears ' +
      'when the browser closes; otherwise it lives for 7 days. The same generic 401 is returned for an unknown email and ' +
      'a wrong password, and for accounts that only use Google sign-in, so the response never reveals which accounts exist. ' +
      'No authentication required.',
  })
  @ApiOkResponse({ type: AuthResponseDto, description: 'Signed in.' })
  @ApiErrors(400, [401, 'Wrong email or password.'], [429, 'Too many sign-in attempts from this client (10 per minute), or error code `LOGIN_LOCKED`: 5 wrong passwords for the same email lock it for 15 minutes (unknown emails too, so the lock reveals nothing).'])
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    return this.respond(res, await this.auth.login(dto));
  }

  @Post('refresh')
  @Throttle(THROTTLE_AUTH.refresh)
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Refresh the access token',
    description:
      'Exchanges the refresh cookie `nf_rt` for a new access token and a new refresh cookie. Refresh tokens are single-use: ' +
      'the presented token is revoked atomically and replaced, so a replayed or concurrent refresh with the same cookie ' +
      'fails. On any failure the cookie is cleared and the client must sign in again. The access token is not required here; ' +
      'only the cookie is.',
  })
  @ApiOkResponse({ type: AuthResponseDto, description: 'New access token and rotated refresh cookie.' })
  @ApiErrors([401, 'The refresh cookie is missing, expired, already used or revoked.'], [429, 'Too many refresh calls from this client (30 per minute).'])
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    try {
      return this.respond(res, await this.auth.refresh(this.readCookie(req)));
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Sign out',
    description:
      'Revokes the refresh token in the cookie and clears the cookie. Any open realtime socket of the user is disconnected ' +
      'so it does not keep rooms of the old session. Always answers 204, even when the cookie is missing or already revoked ' +
      '(idempotent). The short-lived access token cannot be revoked and simply expires.',
  })
  @ApiNoContentResponse({ description: 'Signed out.' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const userId = await this.auth.logout(this.readCookie(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    // Ngắt socket đang mở của user để không giữ room của phiên cũ (thiết bị khác tự làm mới phiên rồi nối lại).
    if (userId) this.events.disconnectUser(userId);
  }

  @Post('change-password')
  @Throttle(THROTTLE_AUTH.changePassword)
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Change password',
    description:
      'Changes the password of the signed-in user. Every other session (refresh token) of the user is revoked; the session ' +
      'identified by the current refresh cookie stays valid. Requires the current password. Accounts created through ' +
      'Google have no password and cannot use this route.',
  })
  @ApiNoContentResponse({ description: 'Password changed; other sessions revoked.' })
  @ApiErrors(
    [400, 'Error codes: `WRONG_PASSWORD` (current password incorrect), `SAME_PASSWORD` (new equals current), `PASSWORD_NOT_SET` (Google-only account). A plain validation error means the new password is too weak.'],
    401,
  )
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.changePassword(user.id, dto, this.readCookie(req));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the signed-in user',
    description:
      'Returns the public profile of the user identified by the access token: contact details, the bank account used for QR ' +
      'payments, consent timestamps for the AI provider and notification preferences. Never returns the password hash.',
  })
  @ApiOkResponse({ type: PublicUserDto, description: 'The current user.' })
  @ApiErrors(401)
  me(@CurrentUser() user: AuthUser): Promise<PublicUserDto> {
    return this.auth.me(user.id);
  }

  @Get('config')
  @ApiOperation({
    summary: 'Get the enabled sign-in methods',
    description:
      'Tells the web client whether Google sign-in is configured on this server so it can show or hide the Google button. ' +
      'No authentication required.',
  })
  @ApiOkResponse({ type: AuthConfigDto, description: 'Sign-in method flags.' })
  getConfig(): AuthConfigDto {
    return { googleEnabled: isGoogleEnabled(this.config) };
  }

  @Get('google')
  @UseGuards(GoogleStartGuard)
  @ApiOperation({
    summary: 'Start Google sign-in',
    description:
      "Browser entry point of the Google OAuth flow: redirects the user to Google's consent screen. Open it with a normal " +
      'page navigation, not with fetch or XHR. Available only when the server has Google credentials configured.',
  })
  @ApiFoundResponse({ description: 'Redirect to accounts.google.com.' })
  @ApiErrors([404, 'Google sign-in is not configured on this server.'])
  googleStart(): void {
    // GoogleStartGuard (passport) đã chuyển hướng.
  }

  @Get('google/callback')
  @UseGuards(GoogleCallbackGuard)
  @ApiOperation({
    summary: 'Google sign-in callback',
    description:
      'Called by Google after the user consents; not meant to be called by API clients. Finds or creates the account by ' +
      'verified Google email, sets the refresh cookie `nf_rt` and redirects the browser to `{PUBLIC_WEB_URL}/auth/callback`. ' +
      'The web app then calls `POST /auth/refresh` to obtain an access token. On failure the redirect carries an `error` ' +
      'query parameter: `google_failed` (Google returned no profile) or `email_unverified` (the Google email is not verified).',
  })
  @ApiFoundResponse({ description: 'Redirect to the web app, with `?error=` when sign-in failed.' })
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const web = `${this.config.get('PUBLIC_WEB_URL', { infer: true })}/auth/callback`;
    const profile = req.user as GoogleProfile | undefined;
    if (!profile) return res.redirect(`${web}?error=google_failed`);

    try {
      this.setRefreshCookie(res, await this.auth.loginWithGoogle(profile));
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        return res.redirect(`${web}?error=email_unverified`);
      }
      throw error;
    }
    res.redirect(web);
  }

  private respond(res: Response, session: Session): AuthResponseDto {
    this.setRefreshCookie(res, session);
    return { accessToken: session.accessToken, user: session.user };
  }

  private setRefreshCookie(res: Response, session: Session) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.cookieOptions(),
      // Không đặt expires = cookie phiên, mất khi đóng trình duyệt.
      ...(session.persistent && { expires: session.refreshExpiresAt }),
    });
  }

  private readCookie(req: Request): string | undefined {
    const value: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' ? value : undefined;
  }

  private cookieOptions(): CookieOptions {
    const production =
      this.config.get('NODE_ENV', { infer: true }) === 'production';
    return {
      httpOnly: true,
      secure: production,
      // Production: FE (Vercel) và BE (Render) khác site nên cần sameSite=none + secure.
      sameSite: production ? 'none' : 'lax',
      path: REFRESH_COOKIE_PATH,
    };
  }
}

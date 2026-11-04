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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
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
  @ApiOperation({ summary: 'Đăng ký bằng email + mật khẩu' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Dữ liệu không hợp lệ' })
  @ApiConflictResponse({ description: 'Email đã được dùng' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    return this.respond(res, await this.auth.register(dto));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập bằng email + mật khẩu' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: 'Dữ liệu không hợp lệ' })
  @ApiUnauthorizedResponse({ description: 'Email hoặc mật khẩu không đúng' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    return this.respond(res, await this.auth.login(dto));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Cấp access token mới từ cookie refresh token (xoay vòng)',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Không có / hết hạn / đã thu hồi' })
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
  @ApiOperation({ summary: 'Thu hồi refresh token hiện tại và xóa cookie' })
  @ApiNoContentResponse()
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
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOperation({
    summary: 'Đổi mật khẩu; thu hồi các phiên đăng nhập khác, giữ phiên hiện tại',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'WRONG_PASSWORD, SAME_PASSWORD, PASSWORD_NOT_SET (tài khoản Google) hoặc mật khẩu mới không đủ mạnh',
  })
  @ApiUnauthorizedResponse()
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
  @ApiOperation({ summary: 'User đang đăng nhập' })
  @ApiOkResponse({ type: PublicUserDto })
  @ApiUnauthorizedResponse()
  me(@CurrentUser() user: AuthUser): Promise<PublicUserDto> {
    return this.auth.me(user.id);
  }

  @Get('config')
  @ApiOperation({
    summary: 'Phương thức đăng nhập đang bật (để FE ẩn/hiện nút Google)',
  })
  @ApiOkResponse({ type: AuthConfigDto })
  getConfig(): AuthConfigDto {
    return { googleEnabled: isGoogleEnabled(this.config) };
  }

  @Get('google')
  @UseGuards(GoogleStartGuard)
  @ApiOperation({
    summary:
      'Bắt đầu đăng nhập Google (chuyển hướng sang Google). 404 khi chưa cấu hình key.',
  })
  @ApiFoundResponse({ description: 'Chuyển hướng sang accounts.google.com' })
  @ApiNotFoundResponse({ description: 'Chưa bật Google OAuth' })
  googleStart(): void {
    // GoogleStartGuard (passport) đã chuyển hướng.
  }

  @Get('google/callback')
  @UseGuards(GoogleCallbackGuard)
  @ApiOperation({
    summary:
      'Google gọi về sau khi đăng nhập; đặt cookie rồi chuyển về {PUBLIC_WEB_URL}/auth/callback',
  })
  @ApiFoundResponse({ description: 'Về trang web, lỗi thì kèm ?error=' })
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

import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../config/env.validation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { type PublicUser, publicUserSelect } from '../users/public-user.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';

const BCRYPT_COST = 10;
const INVALID_CREDENTIALS = 'Email hoặc mật khẩu không đúng.';
const INVALID_SESSION = 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.';
// So khớp với hash giả khi email không tồn tại để thời gian phản hồi không lộ email nào đã đăng ký.
const DUMMY_HASH = bcrypt.hashSync('nestfair-dummy-password', BCRYPT_COST);

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface Session {
  accessToken: string;
  user: PublicUser;
  /** Giá trị thô chỉ để đặt cookie; DB chỉ lưu hash. */
  refreshToken: string;
  refreshExpiresAt: Date;
  persistent: boolean;
}

/** Thông tin lấy từ profile Google (GoogleStrategy). */
export interface GoogleProfile {
  googleId: string;
  email?: string;
  emailVerified: boolean;
  fullName?: string;
  avatarUrl?: string;
}

const hashToken = (raw: string) =>
  createHash('sha256').update(raw).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register(dto: RegisterDto): Promise<Session> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) throw this.emailTaken();

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    let user: PublicUser;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          fullName: dto.fullName,
          phone: dto.phone,
          passwordHash,
        },
        select: publicUserSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.emailTaken();
      }
      throw error;
    }

    return this.createSession(user, true);
  }

  async login(dto: LoginDto): Promise<Session> {
    const found = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { ...publicUserSelect, passwordHash: true },
    });

    const ok = await bcrypt.compare(
      dto.password,
      found?.passwordHash ?? DUMMY_HASH,
    );
    if (!found?.passwordHash || !ok) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const { passwordHash: _, ...user } = found;
    return this.createSession(user, dto.rememberMe ?? true);
  }

  /**
   * Đăng nhập Google: theo googleId → nếu chưa có thì liên kết theo email đã xác minh
   * → nếu chưa có tài khoản thì tạo mới (không có mật khẩu).
   */
  async loginWithGoogle(profile: GoogleProfile): Promise<Session> {
    const linked = await this.prisma.user.findUnique({
      where: { googleId: profile.googleId },
      select: publicUserSelect,
    });
    if (linked) return this.createSession(linked, true);

    const email = profile.email?.trim().toLowerCase();
    // Chỉ tin email Google đã xác minh, nếu không ai đó có thể chiếm tài khoản mật khẩu cùng email.
    if (!email || !profile.emailVerified) {
      throw new UnauthorizedException(
        'Tài khoản Google này chưa xác minh email.',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, avatarUrl: true },
    });
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            googleId: profile.googleId,
            ...(!existing.avatarUrl &&
              profile.avatarUrl && { avatarUrl: profile.avatarUrl }),
          },
          select: publicUserSelect,
        })
      : await this.prisma.user.create({
          data: {
            email,
            googleId: profile.googleId,
            fullName: (profile.fullName?.trim() || email.split('@')[0]).slice(
              0,
              80,
            ),
            avatarUrl: profile.avatarUrl,
          },
          select: publicUserSelect,
        });

    return this.createSession(user, true);
  }

  /** Xoay vòng: token cũ bị thu hồi, cấp token mới cùng lựa chọn "ghi nhớ". */
  async refresh(rawToken: string | undefined): Promise<Session> {
    if (!rawToken) throw new UnauthorizedException(INVALID_SESSION);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { select: publicUserSelect } },
    });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      throw new UnauthorizedException(INVALID_SESSION);
    }

    return this.prisma.$transaction(async (tx) => {
      // Điều kiện revokedAt: null đảm bảo chỉ một request refresh đồng thời thắng.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count !== 1) throw new UnauthorizedException(INVALID_SESSION);

      return this.createSession(stored.user, stored.persistent, tx);
    });
  }

  /** Thu hồi refresh token; trả userId của phiên (để ngắt socket), không có thì null. */
  async logout(rawToken: string | undefined): Promise<string | null> {
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, select: { userId: true } });
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return row?.userId ?? null;
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect,
    });
    if (!user) throw new UnauthorizedException(INVALID_SESSION);
    return user;
  }

  private async createSession(
    user: PublicUser,
    persistent: boolean,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Session> {
    const ttlDays = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + ttlDays * 86_400_000);

    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        persistent,
        expiresAt: refreshExpiresAt,
      },
    });

    const payload: JwtPayload = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn:
        this.config.get('JWT_ACCESS_TTL_MINUTES', { infer: true }) * 60,
    });

    return { accessToken, user, refreshToken, refreshExpiresAt, persistent };
  }

  private emailTaken() {
    return new ConflictException('Email này đã được dùng. Bạn muốn đăng nhập?');
  }
}

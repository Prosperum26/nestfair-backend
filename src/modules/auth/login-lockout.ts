import { HttpStatus } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';

export const LOCKOUT = {
  /** Số lần sai liên tiếp (trong cửa sổ) trước khi khóa. */
  maxFailures: 5,
  /** Cửa sổ đếm và thời gian khóa. */
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
  /** Số email theo dõi tối đa, chặn tràn bộ nhớ khi bị dò bằng email ngẫu nhiên. */
  maxTracked: 10_000,
} as const;

interface Entry {
  failures: number;
  firstAt: number;
  lockedUntil: number;
}

/**
 * Khóa tạm đăng nhập theo email sau nhiều lần sai, bổ sung throttle theo IP (dò mật khẩu từ nhiều IP).
 * Đếm cả email không tồn tại, nên trạng thái khóa không tiết lộ tài khoản nào có thật.
 * Lưu trong bộ nhớ: đủ cho deploy 1 instance; restart thì bộ đếm về 0 (chấp nhận được).
 * Đăng ký bằng `useFactory` trong AuthModule (constructor nhận số, Nest không tự tiêm được).
 */
export class LoginLockout {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly maxTracked: number = LOCKOUT.maxTracked) {}

  get size(): number {
    return this.entries.size;
  }

  /** Ném 429 `LOGIN_LOCKED` nếu email đang bị khóa. */
  assertNotLocked(email: string, now = Date.now()): void {
    const entry = this.entries.get(email);
    if (!entry || entry.lockedUntil <= now) return;
    const retryAfterSeconds = Math.ceil((entry.lockedUntil - now) / 1000);
    throw coded(
      HttpStatus.TOO_MANY_REQUESTS,
      'LOGIN_LOCKED',
      `Bạn nhập sai quá nhiều lần. Thử lại sau ${Math.ceil(retryAfterSeconds / 60)} phút nhé.`,
      { retryAfterSeconds },
    );
  }

  /** Ghi một lần sai; trả `true` đúng lần làm email bị khóa. */
  recordFailure(email: string, now = Date.now()): boolean {
    let entry = this.entries.get(email);
    const stale = entry && (entry.lockedUntil > 0 ? entry.lockedUntil <= now : now - entry.firstAt > LOCKOUT.windowMs);
    if (!entry || stale) {
      this.makeRoom(now);
      entry = { failures: 0, firstAt: now, lockedUntil: 0 };
      this.entries.delete(email);
      this.entries.set(email, entry);
    }
    entry.failures += 1;
    if (entry.failures < LOCKOUT.maxFailures) return false;
    entry.lockedUntil = now + LOCKOUT.lockMs;
    return true;
  }

  reset(email: string): void {
    this.entries.delete(email);
  }

  /** Dọn mục hết hạn; vẫn đầy thì bỏ mục cũ nhất (Map giữ thứ tự chèn). */
  private makeRoom(now: number): void {
    if (this.entries.size < this.maxTracked) return;
    for (const [key, e] of this.entries) {
      const expired = e.lockedUntil > 0 ? e.lockedUntil <= now : now - e.firstAt > LOCKOUT.windowMs;
      if (expired) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxTracked) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

import { Logger } from '@nestjs/common';

/** Logger riêng cho sự kiện bảo mật (đăng nhập sai, khóa tài khoản, origin lạ, refresh bị từ chối). */
export const securityLog = new Logger('Security');

/** Che email trước khi ghi log: `hung@x.vn` → `h***@x.vn`. Không bao giờ ghi mật khẩu hay token. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***@${email.slice(at + 1, at + 61)}`;
}

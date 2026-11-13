import type { ThrottlerModuleOptions } from '@nestjs/throttler';

/** Mức mặc định cho mọi route HTTP (theo IP): đủ rộng cho người dùng thật, chặn quét hàng loạt. */
export const THROTTLE_DEFAULT = { ttl: 60_000, limit: 120 } as const;

/** Ghi đè cho thao tác nặng hoặc dễ bị lạm dụng (check-in, duyệt, upload ảnh tin đăng). */
export const THROTTLE_STRICT = { default: { ttl: 60_000, limit: 20 } } as const;

/** Route xác thực: chặn dò mật khẩu, spam đăng ký, quay vòng refresh. Theo IP. */
export const THROTTLE_AUTH = {
  login: { default: { ttl: 60_000, limit: 10 } },
  register: { default: { ttl: 60_000, limit: 5 } },
  refresh: { default: { ttl: 60_000, limit: 30 } },
  changePassword: { default: { ttl: 60_000, limit: 5 } },
} as const;

/** Tắt khi chạy test (trừ e2e chuyên kiểm throttle, nó ghi đè `skipIf`). */
export const throttlerOptions = {
  throttlers: [{ name: 'default', ...THROTTLE_DEFAULT }],
  errorMessage: 'Bạn thao tác quá nhiều lần, thử lại sau ít phút nhé.',
  skipIf: () => process.env.NODE_ENV === 'test',
} satisfies ThrottlerModuleOptions;

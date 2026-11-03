import { HttpException, type HttpStatus } from '@nestjs/common';

/** Tên lỗi theo mã HTTP, như NestJS đặt cho `error` ("Conflict", "Unprocessable Entity"...). */
const STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

/**
 * Lỗi nghiệp vụ có mã máy đọc được. Giữ nguyên format NestJS chuẩn
 * `{ statusCode, message, error }` (AGENTS.md mục 5) và thêm `code` theo đặc tả Issue #4.
 */
export function coded(
  status: HttpStatus,
  code: string,
  message: string,
  /** Trường thêm cho client (vd. `retryAfterMs`), không đè các trường chuẩn. */
  extra: Record<string, unknown> = {},
): HttpException {
  return new HttpException(
    { ...extra, statusCode: status, message, error: STATUS_NAMES[status] ?? 'Error', code },
    status,
  );
}

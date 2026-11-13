/**
 * Đọc `CORS_ORIGINS` (cách nhau bằng dấu phẩy) thành danh sách origin chuẩn.
 * Ném lỗi khi cấu hình sai để server dừng ngay lúc khởi động, không chạy với CORS hỏng.
 */
export function parseOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (origins.length === 0) throw new Error('CORS_ORIGINS rỗng.');
  for (const origin of origins) {
    if (origin === '*') throw new Error('CORS_ORIGINS không được chứa `*` (cookie refresh cần credentials).');
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`CORS_ORIGINS có mục không phải origin: ${origin}`);
    }
    if (!/^https?:$/.test(url.protocol) || url.origin !== origin) {
      throw new Error(`CORS_ORIGINS có mục không phải origin http(s): ${origin}`);
    }
  }
  return origins;
}

/** So khớp chính xác header `Origin` với danh sách đã chuẩn hóa. */
export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return allowed.includes(origin);
}

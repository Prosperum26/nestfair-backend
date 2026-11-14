/** Link bản đồ của tin đăng: tối đa 500 ký tự. */
export const MAP_URL_MAX = 500;

/** Host chỉ nhận khi đường dẫn bắt đầu bằng `/maps` (google.com còn có Search, Gmail...). */
const MAPS_PATH_HOSTS = new Set(['google.com', 'www.google.com', 'google.com.vn', 'www.google.com.vn']);
/** Host chỉ dành cho bản đồ. */
const MAPS_ONLY_HOSTS = new Set(['maps.google.com', 'maps.app.goo.gl']);

/**
 * Link Google Maps hợp lệ để đưa lên trang công khai: https, không user/mật khẩu, không cổng riêng, host đúng
 * danh sách (so khớp nguyên host, nên `google.com.evil.com` bị loại). Chỉ kiểm chuỗi, server không mở link.
 */
export function isGoogleMapsUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAP_URL_MAX) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (MAPS_ONLY_HOSTS.has(host)) return true;
  if (host === 'goo.gl') return url.pathname.startsWith('/maps/');
  return MAPS_PATH_HOSTS.has(host) && (url.pathname === '/maps' || url.pathname.startsWith('/maps/'));
}

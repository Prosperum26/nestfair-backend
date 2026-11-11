/** Tháng theo giờ Việt Nam (UTC+7, không có DST). Khóa tháng dạng `YYYY-MM`. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Khóa tháng (giờ VN) chứa thời điểm `date`. */
export function monthKeyOf(date: Date): string {
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Khoảng nửa mở [start, end) của tháng theo giờ VN. */
export function monthRange(key: string): { start: Date; end: Date } {
  const m = MONTH_KEY.exec(key);
  if (!m) throw new Error(`Khóa tháng không hợp lệ: ${key}`);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  return {
    start: new Date(Date.UTC(year, month, 1) - VN_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - VN_OFFSET_MS),
  };
}

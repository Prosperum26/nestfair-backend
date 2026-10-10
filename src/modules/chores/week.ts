/** Tuần ISO (Thứ Hai → Chủ Nhật) tính theo giờ Việt Nam (UTC+7, không có DST). */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_KEY = /^(\d{4})-W(\d{2})$/;

/** Thứ Hai 00:00 (giờ VN) của tuần 1 ISO, trả về dưới dạng ms epoch. */
function weekOneStart(year: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7; // T2 = 0
  return jan4 - dow * DAY_MS - VN_OFFSET_MS;
}

function weeksInYear(year: number): number {
  return Math.round((weekOneStart(year + 1) - weekOneStart(year)) / (7 * DAY_MS));
}

function format(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function isValidWeekKey(value: string): boolean {
  const m = WEEK_KEY.exec(value);
  if (!m) return false;
  const week = Number(m[2]);
  return week >= 1 && week <= weeksInYear(Number(m[1]));
}

export function weekKeyOf(date: Date): string {
  const vn = new Date(date.getTime() + VN_OFFSET_MS);
  // Năm ISO là năm của ngày Thứ Năm trong cùng tuần.
  const dow = (vn.getUTCDay() + 6) % 7;
  const thursday = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() - dow + 3));
  const year = thursday.getUTCFullYear();
  const start = weekOneStart(year) + VN_OFFSET_MS; // so sánh trong "giờ VN giả UTC"
  const weekNo = Math.floor((thursday.getTime() - start) / (7 * DAY_MS)) + 1;
  return format(year, weekNo);
}

export function weekRange(weekKey: string): { start: Date; dueAt: Date } {
  const m = WEEK_KEY.exec(weekKey);
  if (!m || !isValidWeekKey(weekKey)) throw new Error(`weekKey không hợp lệ: ${weekKey}`);
  const start = weekOneStart(Number(m[1])) + (Number(m[2]) - 1) * 7 * DAY_MS;
  return { start: new Date(start), dueAt: new Date(start + 7 * DAY_MS - 1) };
}

export function shiftWeek(weekKey: string, delta: number): string {
  const { start } = weekRange(weekKey);
  return weekKeyOf(new Date(start.getTime() + delta * 7 * DAY_MS + DAY_MS));
}

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

// ---- Ngày dạng chuỗi "YYYY-MM-DD" (ngày theo giờ nhà), dùng cho thuật toán sinh lịch ----

/** Ngày VN dạng "YYYY-MM-DD". */
export type DateStr = string;

const utcOf = (d: DateStr): number => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
};
const fmt = (ms: number): DateStr => new Date(ms).toISOString().slice(0, 10);

/** Ngày giờ VN của một thời điểm. */
export function toDateStr(date: Date): DateStr {
  return fmt(date.getTime() + VN_OFFSET_MS);
}

export function addDays(d: DateStr, n: number): DateStr {
  return fmt(utcOf(d) + n * DAY_MS);
}

/** ISO 1 = Thứ Hai … 7 = Chủ Nhật. */
export function isoDow(d: DateStr): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return (((new Date(utcOf(d)).getUTCDay() + 6) % 7) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** Thứ Hai của tuần chứa ngày/thời điểm đã cho. */
export function weekStartOf(x: Date | DateStr): DateStr {
  const d = typeof x === 'string' ? x : toDateStr(x);
  return addDays(d, -(isoDow(d) - 1));
}

export function currentWeekStart(now: Date = new Date()): DateStr {
  return weekStartOf(now);
}

/** "2026-W41" của tuần bắt đầu thứ Hai `weekStart`. */
export function weekKeyFromStart(weekStart: DateStr): string {
  const thursday = addDays(weekStart, 3);
  const year = Number(thursday.slice(0, 4));
  const dayOfYear = (utcOf(thursday) - Date.UTC(year, 0, 1)) / DAY_MS;
  return `${year}-W${String(Math.floor(dayOfYear / 7) + 1).padStart(2, '0')}`;
}

/** Thứ Hai của tuần ISO `weekKey` (đã hợp lệ). */
export function weekStartFromKey(weekKey: string): DateStr {
  const [year, week] = weekKey.split('-W').map(Number);
  return addDays(weekStartOf(`${year}-01-04`), (week - 1) * 7);
}

/** Các ngày trong tuần ứng với `recurrenceDays` (ISO 1..7), theo thứ tự tăng dần. */
export function occurrenceDates(weekStart: DateStr, recurrenceDays: number[]): DateStr[] {
  return [...new Set(recurrenceDays)].sort((a, b) => a - b).map((d) => addDays(weekStart, d - 1));
}

/** Thời điểm UTC của "HH:mm" giờ VN vào ngày `date`. */
export function dueAtOf(date: DateStr, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - VN_OFFSET_MS);
}

/** 00:00 giờ VN của ngày `date`: lúc mở cửa sổ check-in. */
export function openAtOf(date: DateStr): Date {
  return dueAtOf(date, '00:00');
}

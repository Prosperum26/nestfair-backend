import type { AssignmentSource } from '../../../generated/prisma/enums.js';
import { addDays, dueAtOf, weekStartOf } from '../../chores/week.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type SwapKind = 'EXCHANGE' | 'COVER' | 'PERMANENT';

export type SwapWarning = 'WEIGHT_GAP' | 'CONSECUTIVE_DAY' | 'DUE_SOON' | 'FENCE_REPEAT' | 'OVER_DAILY_CAP';

const earliest = (dates: Date[]): number => Math.min(...dates.map((d) => d.getTime()));

/** < 6 giờ tới hạn: COVER chỉ đăng được lên Chợ ca (spec 4.5). */
export function isUrgentCover(now: Date, dueAt: Date): boolean {
  return dueAt.getTime() - now.getTime() < 6 * HOUR;
}

/** Hạn phản hồi do server tính, bất biến sau khi tạo (spec 4.5). `dueAts` là hạn của các ca liên quan. */
export function expiresAtFor(type: SwapKind, createdAt: Date, dueAts: Date[]): Date {
  const day = createdAt.getTime() + 24 * HOUR;
  if (type === 'EXCHANGE') return new Date(Math.min(day, earliest(dueAts) - HOUR));
  if (type === 'COVER') {
    const due = earliest(dueAts);
    if (isUrgentCover(createdAt, new Date(due))) return new Date(due - HOUR);
    return new Date(Math.min(day, due - 6 * HOUR));
  }
  // PERMANENT: kịp trước cron sinh lịch 20:00 Chủ Nhật.
  const sunday = dueAtOf(addDays(weekStartOf(createdAt), 6), '19:00');
  return new Date(Math.min(createdAt.getTime() + 48 * HOUR, sunday.getTime()));
}

/** Còn ít nhất 15 phút trước mốc `dueAt − 1h` thì mới leo thang được (spec 4.5). */
export function escalationWindowOk(now: Date, dueAt: Date): boolean {
  return dueAt.getTime() - HOUR - now.getTime() >= 15 * MINUTE;
}

/** Còn dưới 90 phút tới hạn sớm nhất thì không kịp đổi (R-SWAP-11). */
export function tooLateToRequest(now: Date, dueAts: Date[]): boolean {
  return earliest(dueAts) - now.getTime() < 90 * MINUTE;
}

/** Đã quá hạn nhưng còn trong ân hạn nộp muộn (R-SWAP-4, D8). */
export function inGrace(now: Date, dueAt: Date, graceHours: number): boolean {
  const t = now.getTime();
  return t > dueAt.getTime() && t <= dueAt.getTime() + graceHours * HOUR;
}

/** Bảng 4.3: loại ca nào áp dụng được thao tác nào. */
export function slotSwapSource(source: AssignmentSource): { exchange: boolean; cover: boolean; payback: boolean } {
  switch (source) {
    case 'COVER':
      return { exchange: true, cover: false, payback: false };
    case 'PAYBACK':
      return { exchange: false, cover: false, payback: false };
    case 'WHEEL':
      // D4: chỉ nhờ bằng quà, không đổi, không làm bù.
      return { exchange: false, cover: true, payback: false };
    default:
      return { exchange: true, cover: true, payback: true };
  }
}

export interface WeightWarningInput {
  /** weight của ca gửi. */
  weightA: number;
  /** weight của ca đích; null với COVER (không có ca thứ hai). */
  weightB: number | null;
  /** Hạn sớm nhất trong các ca mà người nhận sẽ làm. */
  minDueAt: Date;
  now: Date;
  /** Tính sẵn từ lịch sử (W-2, W-3, W-4), validator không để hàm thuần tự truy vấn. */
  fenceRepeat: boolean;
  overDailyCap: boolean;
  consecutiveDay: boolean;
}

/** Cảnh báo mềm W-1 … W-5, theo thứ tự cố định để so sánh với `acknowledgedWarnings`. */
export function weightWarnings(input: WeightWarningInput): SwapWarning[] {
  const out: SwapWarning[] = [];
  if (input.weightB !== null && Math.abs(input.weightA - input.weightB) >= 2) out.push('WEIGHT_GAP');
  if (input.fenceRepeat) out.push('FENCE_REPEAT');
  if (input.overDailyCap) out.push('OVER_DAILY_CAP');
  if (input.consecutiveDay) out.push('CONSECUTIVE_DAY');
  if (isUrgentCover(input.now, input.minDueAt)) out.push('DUE_SOON');
  return out;
}

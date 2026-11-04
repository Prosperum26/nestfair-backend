import { addDays, dueAtOf, toDateStr } from '../../chores/week.js';

/** Hạn chót của ca vòng quay phải nằm trong [now + 30 phút, now + 48 giờ] (đặc tả #5 mục 13.1). */
export const MIN_DUE_MS = 30 * 60_000;
export const MAX_DUE_MS = 48 * 3_600_000;

export type DueKey = 'IN_2H' | 'TONIGHT' | 'END_OF_DAY' | 'TOMORROW';

export interface DueOption {
  key: DueKey;
  label: string;
  dueAt: Date;
  valid: boolean;
  /** Lý do không chọn được (UI làm mờ và hiện lý do). */
  reason: string | null;
}

export function isDueValid(now: Date, dueAt: Date): boolean {
  const ms = dueAt.getTime() - now.getTime();
  return ms >= MIN_DUE_MS && ms <= MAX_DUE_MS;
}

/** Các mốc hạn chọn sẵn theo giờ nhà (Asia/Ho_Chi_Minh), làm tròn xuống phút. */
export function dueOptions(now: Date): DueOption[] {
  const today = toDateStr(now);
  const in2h = new Date(Math.floor((now.getTime() + 2 * 3_600_000) / 60_000) * 60_000);
  const raw: [DueKey, string, Date][] = [
    ['IN_2H', 'Trong 2 giờ', in2h],
    ['TONIGHT', 'Hôm nay 21:00', dueAtOf(today, '21:00')],
    ['END_OF_DAY', 'Hết hôm nay 23:59', dueAtOf(today, '23:59')],
    ['TOMORROW', 'Ngày mai 21:00', dueAtOf(addDays(today, 1), '21:00')],
  ];
  return raw.map(([key, label, dueAt]) => {
    const ms = dueAt.getTime() - now.getTime();
    const valid = isDueValid(now, dueAt);
    const reason = valid ? null : ms < MIN_DUE_MS ? 'Còn chưa tới 30 phút' : 'Xa hơn 48 giờ';
    return { key, label, dueAt, valid, reason };
  });
}

/** Mặc định "hết hôm nay 23:59"; không hợp lệ thì lấy mốc hợp lệ gần mốc đó nhất. */
export function defaultDueKey(options: readonly DueOption[]): DueKey | null {
  const eod = options.find((o) => o.key === 'END_OF_DAY')!;
  if (eod.valid) return eod.key;
  const valid = options.filter((o) => o.valid);
  if (valid.length === 0) return null;
  return valid.reduce((best, o) =>
    Math.abs(o.dueAt.getTime() - eod.dueAt.getTime()) < Math.abs(best.dueAt.getTime() - eod.dueAt.getTime()) ? o : best,
  ).key;
}

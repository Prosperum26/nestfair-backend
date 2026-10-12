export type SlotSource = 'ROTATION' | 'SWAP' | 'COVER' | 'PAYBACK' | 'WHEEL' | 'REASSIGN';

/** Số tuần có lịch dùng để tính tải tích lũy (R-FAIR-2). */
export const LOAD_WEEKS = 6;

/**
 * Một ca trong lịch sử. `weeksBack` đếm theo **tuần có lịch**: 1 = tuần có lịch gần nhất.
 * Người gọi đã lọc status (chỉ TODO / PENDING_VERIFY / REJECTED / DONE) và đã dùng assignee hiện tại.
 */
export interface HistSlot {
  weeksBack: number;
  choreId: string;
  memberId: string;
  weight: number;
  source: SlotSource;
}

/**
 * Tải tích lũy mỗi người = Σ weight trong 6 tuần có lịch gần nhất, gồm cả ca WHEEL.
 * `credit` (tín dụng trung lập khi vắng cả tuần) và `baseline` (người mới vào) được cộng thêm.
 */
export function rollingLoad(
  history: readonly HistSlot[],
  memberIds: readonly string[],
  opts: { credit?: Record<string, number>; baseline?: Record<string, number> },
): Record<string, number> {
  const load: Record<string, number> = Object.fromEntries(
    memberIds.map((m) => [m, (opts.credit?.[m] ?? 0) + (opts.baseline?.[m] ?? 0)]),
  );
  for (const h of history) {
    if (h.weeksBack >= 1 && h.weeksBack <= LOAD_WEEKS && h.memberId in load) load[h.memberId] += h.weight;
  }
  return load;
}

/**
 * Người vắng cả tuần được tính tải trung bình nhà của tuần đó (tín dụng trung lập),
 * để lúc quay lại không bị dồn việc nặng.
 */
export function neutralCredits(
  weeks: readonly { weeksBack: number; loadByMember: Record<string, number>; absentWholeWeek: ReadonlySet<string> }[],
): Record<string, number> {
  const credit: Record<string, number> = {};
  for (const w of weeks) {
    if (w.weeksBack < 1 || w.weeksBack > LOAD_WEEKS || w.absentWholeWeek.size === 0) continue;
    const loads = Object.values(w.loadByMember);
    if (loads.length === 0) continue;
    const avg = Math.round(loads.reduce((a, b) => a + b, 0) / loads.length);
    for (const m of w.absentWholeWeek) credit[m] = (credit[m] ?? 0) + avg;
  }
  return credit;
}

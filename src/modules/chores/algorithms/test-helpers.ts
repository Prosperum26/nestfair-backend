import type { DateStr } from '../week.js';
import { addDays } from '../week.js';
import type { HistSlot } from './load.js';
import { type GenChore, type GenInput, type GenMember, type GenResult, type GenSlot, generateWeek } from './schedule-generator.js';

/** Dùng chung cho các spec của thuật toán (không phải spec, không được vitest nạp). */
export const members = (n: number, absent: Record<string, DateStr[]> = {}): GenMember[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, absentDates: new Set(absent[`m${i + 1}`] ?? []) }));

export const blockChore = (id: string, weight: number, days: number[] = [7]): GenChore => ({
  id,
  weight,
  frequency: 'WEEKLY',
  recurrenceDays: days,
  rotationMode: 'WEEK_BLOCK',
  occurrenceGap: 1,
});

export const perChore = (id: string, weight: number, days: number[] = [1, 2, 3, 4, 5, 6, 7], gap = 1): GenChore => ({
  id,
  weight,
  frequency: days.length === 7 ? 'DAILY' : 'WEEKLY',
  recurrenceDays: days,
  rotationMode: 'PER_OCCURRENCE',
  occurrenceGap: gap,
});

export interface SimOptions {
  members: GenMember[];
  chores: GenChore[];
  weeks: number;
  seed: number;
  startWeek?: DateStr;
  maxSlotsPerDay?: number;
  extraHistory?: HistSlot[];
}

/** Sinh `weeks` tuần liên tiếp, nối lịch sử và đuôi PER_OCCURRENCE từ kết quả tuần trước. */
export function simulate(o: SimOptions): { results: GenResult[]; weekStarts: DateStr[] } {
  const results: GenResult[] = [];
  const weekStarts: DateStr[] = [];
  const past: GenSlot[][] = [];
  let weekStart = o.startWeek ?? '2026-10-05';
  for (let w = 0; w < o.weeks; w++) {
    const history: HistSlot[] = [...(o.extraHistory ?? [])];
    [...past].reverse().forEach((slots, idx) => {
      for (const s of slots) {
        if (!s.memberId) continue;
        const weight = o.chores.find((c) => c.id === s.choreId)!.weight;
        history.push({ weeksBack: idx + 1, choreId: s.choreId, memberId: s.memberId, weight, source: s.source });
      }
    });
    const prevTail: Record<string, string | null> = {};
    for (const slots of past) {
      for (const s of slots) if (s.memberId) prevTail[s.choreId] = s.memberId;
    }
    const input: GenInput = {
      seed: o.seed * 1000 + w,
      weekStart,
      houseBreakDates: new Set(),
      maxSlotsPerDay: o.maxSlotsPerDay ?? 2,
      members: o.members,
      chores: o.chores,
      history,
      prevTail,
      pinned: [],
    };
    const res = generateWeek(input);
    results.push(res);
    weekStarts.push(weekStart);
    past.push(res.slots);
    weekStart = addDays(weekStart, 7);
  }
  return { results, weekStarts };
}

/** Cặp `${member}|${chore}` mà mỗi người đã làm trong `lookback` tuần liền trước tuần `index`. */
export function blockPairsBefore(results: GenResult[], index: number, lookback: number, blockChoreIds: Set<string>): Set<string> {
  const out = new Set<string>();
  for (let k = 1; k <= lookback && index - k >= 0; k++) {
    for (const s of results[index - k].slots) if (s.memberId && blockChoreIds.has(s.choreId)) out.add(`${s.memberId}|${s.choreId}`);
  }
  return out;
}

import { addDays, type DateStr, occurrenceDates } from '../week.js';
import { type HistSlot, rollingLoad, type SlotSource } from './load.js';
import { blockSequence } from './per-occurrence.js';
import { mulberry32 } from './rng.js';
import { type BlockChore, solveWeekBlocks } from './week-block.js';

export const ALGO_VERSION = 'v2';

export interface GenMember {
  id: string;
  absentDates: ReadonlySet<DateStr>;
  /** Mới vào nhà: tải khởi điểm = trung bình tải các thành viên khác (S-17). */
  isNew?: boolean;
}

export interface GenChore {
  id: string;
  weight: number;
  frequency: 'DAILY' | 'WEEKLY' | 'ADHOC';
  /** ISO 1 = Thứ Hai … 7 = Chủ Nhật. */
  recurrenceDays: number[];
  rotationMode: 'WEEK_BLOCK' | 'PER_OCCURRENCE';
  occurrenceGap: number;
}

/** Ca gắn trước (R-FAIR-4: PAYBACK từ ChoreDebt, Issue #7). */
export interface PinnedSlot {
  choreId: string;
  date: DateStr;
  memberId: string;
  source: SlotSource;
}

export interface GenInput {
  seed: number;
  weekStart: DateStr;
  houseBreakDates: ReadonlySet<DateStr>;
  maxSlotsPerDay: number;
  members: GenMember[];
  chores: GenChore[];
  /** Ca của các tuần có lịch trước đó (đã lọc status, dùng assignee hiện tại). */
  history: HistSlot[];
  /** Người làm lần cuối của mỗi việc PER_OCCURRENCE ở tuần trước. */
  prevTail: Record<string, string | null>;
  pinned: PinnedSlot[];
  /** Tín dụng trung lập cho người từng vắng cả tuần (S-21). */
  credit?: Record<string, number>;
}

export interface GenSlot {
  choreId: string;
  occurrenceDate: DateStr;
  slotIndex: 0;
  /** null = UNASSIGNED (H2: không bao giờ bỏ rơi im lặng, luôn có `reason`). */
  memberId: string | null;
  source: SlotSource;
  reason?: string;
}

export interface GenResult {
  status: 'PUBLISHED' | 'EMPTY';
  slots: GenSlot[];
  relaxLevel: number;
  relaxed: boolean;
  /** W_eff đã áp dụng. */
  fenceWeeksApplied: number;
  attempts: number;
  reasons: string[];
  seed: number;
  loadAfter: Record<string, number>;
}

const key = (m: string, d: DateStr) => `${m}|${d}`;

/**
 * Sinh lịch một tuần. Hàm thuần: cùng đầu vào + cùng seed cho cùng kết quả.
 * Thứ tự: ghim → PER_OCCURRENCE (khối hoán vị) → sửa vắng / vượt ca-ngày → WEEK_BLOCK (nới rào dần).
 */
export function generateWeek(inp: GenInput): GenResult {
  const rnd = mulberry32(inp.seed);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(inp.weekStart, i));
  const reasons: string[] = [];
  const addReason = (r: string) => {
    if (!reasons.includes(r)) reasons.push(r);
  };
  const empty = (reason: string, wEff = 3): GenResult => ({
    status: 'EMPTY',
    slots: [],
    relaxLevel: 0,
    relaxed: false,
    fenceWeeksApplied: wEff,
    attempts: 0,
    reasons: [reason],
    seed: inp.seed,
    loadAfter: {},
  });

  const rotatable = inp.chores.filter((c) => c.frequency !== 'ADHOC');
  if (rotatable.length === 0) return empty('NO_CHORES');
  const datesOf = new Map(
    rotatable.map((c) => [c.id, occurrenceDates(inp.weekStart, c.recurrenceDays).filter((d) => !inp.houseBreakDates.has(d))]),
  );
  const chores = rotatable.filter((c) => (datesOf.get(c.id) ?? []).length > 0);
  if (chores.length === 0) return empty(inp.houseBreakDates.size > 0 ? 'HOUSE_BREAK' : 'NO_CHORES');

  const members = inp.members.filter((m) => !weekDates.every((d) => m.absentDates.has(d)));
  if (members.length === 0) return empty('NO_ELIGIBLE_MEMBERS');
  if (members.length < inp.members.length) addReason('MEMBER_ABSENT');

  const ids = members.map((m) => m.id);
  const byId = new Map(members.map((m) => [m.id, m]));
  const available = (m: string, d: DateStr) => byId.has(m) && !byId.get(m)!.absentDates.has(d);
  const wEff = Math.min(3, members.length);
  if (members.length === 1) addReason('SOLO_HOUSE');
  else if (members.length === 2) addReason('SMALL_HOUSE');

  // ---- Tải khởi điểm ----
  const load = rollingLoad(inp.history, ids, { credit: inp.credit });
  const veterans = members.filter((m) => !m.isNew);
  if (members.some((m) => m.isNew) && veterans.length > 0) {
    const avg = Math.round(veterans.reduce((s, m) => s + load[m.id], 0) / veterans.length);
    for (const m of members) if (m.isNew) load[m.id] = Math.max(load[m.id], avg);
    addReason('NEW_MEMBER');
  }

  // ---- Slot ----
  const slotsOf = new Map<string, GenSlot[]>();
  const choreById = new Map(chores.map((c) => [c.id, c]));
  for (const c of chores) {
    slotsOf.set(
      c.id,
      datesOf.get(c.id)!.map((d) => ({ choreId: c.id, occurrenceDate: d, slotIndex: 0 as const, memberId: null, source: 'ROTATION' as SlotSource })),
    );
  }
  const dayCount = new Map<string, number>();
  const countOf = (m: string, d: DateStr) => dayCount.get(key(m, d)) ?? 0;
  const assign = (s: GenSlot, m: string, source?: SlotSource) => {
    s.memberId = m;
    s.reason = undefined;
    if (source) s.source = source;
    load[m] += choreById.get(s.choreId)!.weight;
    dayCount.set(key(m, s.occurrenceDate), countOf(m, s.occurrenceDate) + 1);
  };
  const unassign = (s: GenSlot) => {
    const m = s.memberId!;
    load[m] -= choreById.get(s.choreId)!.weight;
    dayCount.set(key(m, s.occurrenceDate), countOf(m, s.occurrenceDate) - 1);
    s.memberId = null;
  };

  const fenceCache = new Map<number, Set<string>>();
  const fence = (lookback: number): Set<string> => {
    if (!fenceCache.has(lookback)) {
      fenceCache.set(
        lookback,
        new Set(inp.history.filter((h) => h.weeksBack <= lookback && h.source !== 'WHEEL').map((h) => key(h.memberId, h.choreId))),
      );
    }
    return fenceCache.get(lookback)!;
  };

  // ---- Ghim (R-FAIR-4) ----
  const pinnedKeys = new Set<string>();
  const pinnedOwner = new Map<string, string>();
  for (const p of inp.pinned) {
    const slot = slotsOf.get(p.choreId)?.find((s) => s.occurrenceDate === p.date);
    if (!slot || !available(p.memberId, p.date)) continue;
    assign(slot, p.memberId, p.source);
    pinnedKeys.add(`${p.choreId}|${p.date}`);
    if (choreById.get(p.choreId)!.rotationMode === 'WEEK_BLOCK') pinnedOwner.set(p.choreId, p.memberId);
    if (fence(wEff - 1).has(key(p.memberId, p.choreId))) addReason('PINNED_OVERRIDE');
  }
  const isPinned = (s: GenSlot) => pinnedKeys.has(`${s.choreId}|${s.occurrenceDate}`);

  // ---- PER_OCCURRENCE ----
  const perChores = chores.filter((c) => c.rotationMode === 'PER_OCCURRENCE');
  for (const c of perChores) {
    const open = slotsOf.get(c.id)!.filter((s) => !isPinned(s));
    const seq = blockSequence({ memberIds: ids, length: open.length, prev: inp.prevTail[c.id] ?? null, load, gap: c.occurrenceGap, rnd });
    open.forEach((s, i) => assign(s, seq[i]));
  }

  /** Người `cand` đặt vào vị trí `i` của chuỗi `arr` có phạm gap không (tính cả đuôi tuần trước)? */
  const gapOk = (c: GenChore, arr: GenSlot[], i: number, cand: string) => {
    for (let j = 1; j <= c.occurrenceGap; j++) {
      const before = i - j >= 0 ? arr[i - j].memberId : i - j === -1 ? (inp.prevTail[c.id] ?? null) : null;
      if (before === cand) return false;
      if (i + j < arr.length && arr[i + j].memberId === cand) return false;
    }
    return true;
  };
  const pickReplacement = (c: GenChore, arr: GenSlot[], i: number, from: string | null, requireCap: boolean, requireGap: boolean) => {
    const slot = arr[i];
    return ids
      .filter(
        (m) =>
          m !== from &&
          available(m, slot.occurrenceDate) &&
          (!requireCap || countOf(m, slot.occurrenceDate) + 1 <= inp.maxSlotsPerDay) &&
          (!requireGap || gapOk(c, arr, i, m)),
      )
      .sort((a, b) => load[a] - load[b])[0];
  };

  // Sửa H1: người được giao vào ngày họ vắng.
  for (const c of perChores) {
    const arr = slotsOf.get(c.id)!;
    arr.forEach((s, i) => {
      if (s.memberId === null || available(s.memberId, s.occurrenceDate) || isPinned(s)) return;
      const from = s.memberId;
      unassign(s);
      addReason('MEMBER_ABSENT');
      const repl =
        pickReplacement(c, arr, i, from, true, true) ?? pickReplacement(c, arr, i, from, false, true) ?? pickReplacement(c, arr, i, from, false, false);
      if (repl) assign(s, repl);
      else s.reason = 'MEMBER_ABSENT';
    });
  }

  // Sửa H3: dời bớt ca của người vượt số ca/ngày sang người còn chỗ.
  for (let guard = 0; guard < 300; guard++) {
    let moved = false;
    for (const [k, n] of dayCount) {
      if (n <= inp.maxSlotsPerDay) continue;
      const [m, d] = k.split('|');
      for (const c of perChores) {
        const arr = slotsOf.get(c.id)!;
        const i = arr.findIndex((s) => s.occurrenceDate === d && s.memberId === m && !isPinned(s));
        if (i < 0) continue;
        const repl = pickReplacement(c, arr, i, m, true, true);
        if (!repl) continue;
        unassign(arr[i]);
        assign(arr[i], repl);
        moved = true;
        break;
      }
      if (moved) break;
    }
    if (!moved) break;
  }

  // ---- WEEK_BLOCK ----
  const perSlotFallback = (s: GenSlot) => {
    const avail = ids.filter((m) => available(m, s.occurrenceDate));
    const pool = avail.filter((m) => countOf(m, s.occurrenceDate) + 1 <= inp.maxSlotsPerDay);
    const pick = (pool.length > 0 ? pool : avail).sort((a, b) => load[a] - load[b])[0];
    if (pick) assign(s, pick);
    else s.reason = 'MEMBER_ABSENT';
    addReason('MEMBER_ABSENT');
  };

  const solveList: BlockChore[] = [];
  const eligible: Record<string, string[]> = {};
  for (const c of chores.filter((x) => x.rotationMode === 'WEEK_BLOCK')) {
    const open = slotsOf.get(c.id)!.filter((s) => !isPinned(s));
    if (open.length === 0) continue;
    const owner = pinnedOwner.get(c.id);
    if (owner) {
      for (const s of open) {
        if (available(owner, s.occurrenceDate)) assign(s, owner);
        else perSlotFallback(s);
      }
      continue;
    }
    const dates = open.map((s) => s.occurrenceDate);
    const ok = ids.filter((m) => dates.every((d) => available(m, d)));
    if (ok.length === 0) {
      open.forEach(perSlotFallback);
      continue;
    }
    solveList.push({ id: c.id, weight: c.weight, dates });
    eligible[c.id] = ok;
  }

  let relaxLevel = 0;
  let attempts = 0;
  if (solveList.length > 0) {
    const res = solveWeekBlocks({ chores: solveList, eligible, fence, wEff, load, dayCount: countOf, cap: inp.maxSlotsPerDay, rnd });
    attempts = res.attempts;
    relaxLevel = res.levelIndex;
    for (const b of solveList) {
      const m = res.assignment[b.id];
      for (const s of slotsOf.get(b.id)!.filter((x) => !isPinned(x))) {
        if (m) assign(s, m);
        else s.reason = 'MEMBER_ABSENT';
      }
    }
    if (res.levelIndex > 0 && !res.minViolation) addReason('FEW_OPTIONS');
    if (res.minViolation) {
      addReason('FEW_OPTIONS');
      addReason('NO_SOLUTION_MIN_VIOLATION');
    }
  }

  const slots = [...slotsOf.values()].flat().sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || a.choreId.localeCompare(b.choreId));
  for (const n of dayCount.values()) {
    if (n > inp.maxSlotsPerDay) {
      addReason('DAILY_CAP_EXCEEDED');
      break;
    }
  }

  assertHardConstraints(slots, available);

  return {
    status: 'PUBLISHED',
    slots,
    relaxLevel,
    relaxed: relaxLevel > 0,
    fenceWeeksApplied: wEff,
    attempts,
    reasons,
    seed: inp.seed,
    loadAfter: Object.fromEntries(ids.map((m) => [m, load[m]])),
  };
}

/** H1 (đúng người, đúng ngày), H2 (mọi slot có chủ hoặc có lý do), không trùng (việc, ngày). Sai thì ném, KHÔNG lưu. */
function assertHardConstraints(slots: readonly GenSlot[], available: (m: string, d: DateStr) => boolean) {
  const seen = new Set<string>();
  for (const s of slots) {
    const id = `${s.choreId}|${s.occurrenceDate}|${s.slotIndex}`;
    if (seen.has(id)) throw new Error(`HARD_CONSTRAINT_VIOLATION: slot trùng ${id}`);
    seen.add(id);
    if (s.memberId === null) {
      if (!s.reason) throw new Error(`HARD_CONSTRAINT_VIOLATION: slot ${id} không có chủ và không có lý do`);
    } else if (!available(s.memberId, s.occurrenceDate)) {
      throw new Error(`HARD_CONSTRAINT_VIOLATION: ${s.memberId} không khả dụng vào ${s.occurrenceDate} (${id})`);
    }
  }
}

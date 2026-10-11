import type { DateStr } from '../week.js';
import { fisherYates } from './rng.js';

/** Việc `WEEK_BLOCK` cần giải trong tuần: một người sở hữu mọi ngày `dates` của việc. */
export interface BlockChore {
  id: string;
  weight: number;
  dates: DateStr[];
}

interface Core {
  chores: readonly BlockChore[];
  /** choreId → người đủ điều kiện (không vắng vào bất kỳ ngày nào của việc). */
  eligible: Record<string, readonly string[]>;
  /** Tập `${memberId}|${choreId}` bị cấm bởi rào. */
  forbidden: ReadonlySet<string>;
  /** Tải tích lũy hiện tại (đã gồm ca PER_OCCURRENCE và ca ghim đã gán). */
  load: Record<string, number>;
  /** Số ca người đó đã có trong ngày (từ các bước trước). */
  dayCount: (memberId: string, date: DateStr) => number;
  cap: number;
  rnd: () => number;
}

export interface SolveParams extends Omit<Core, 'forbidden'> {
  /** Tập cặp bị cấm khi nhìn lại `lookback` tuần có lịch (0 = không có rào). */
  fence: (lookback: number) => ReadonlySet<string>;
  /** Cửa sổ rào hiệu dụng min(3, N). */
  wEff: number;
}

export interface BlockSolveResult {
  assignment: Record<string, string>;
  /** 0 = rào đầy đủ; > 0 = đã nới. */
  levelIndex: number;
  attempts: number;
  /** Có người vượt số ca/ngày tối đa vì không còn ai khác. */
  capExceeded: boolean;
  /** Mọi cấp vô nghiệm: dùng phương án ít lặp nhất. */
  minViolation: boolean;
}

const GREEDY_ATTEMPTS = 200;
const BACKTRACK_NODE_LIMIT = 5000;

type Local = Map<string, number>;
const key = (m: string, d: DateStr) => `${m}|${d}`;

function capOk(core: Core, local: Local, m: string, c: BlockChore): boolean {
  return c.dates.every((d) => core.dayCount(m, d) + (local.get(key(m, d)) ?? 0) + 1 <= core.cap);
}
function place(local: Local, m: string, c: BlockChore, delta: 1 | -1) {
  for (const d of c.dates) local.set(key(m, d), (local.get(key(m, d)) ?? 0) + delta);
}

/** Người ứng viên cho việc `c`: đủ điều kiện, không bị cấm, không vượt cap. Đã xáo để hòa tải thì ngẫu nhiên. */
function candidates(core: Core, local: Local, c: BlockChore): string[] {
  return fisherYates(core.eligible[c.id] ?? [], core.rnd).filter(
    (m) => !core.forbidden.has(`${m}|${c.id}`) && capOk(core, local, m, c),
  );
}

/**
 * Greedy ngẫu nhiên: luôn chọn việc ít ứng viên nhất (MRV), hòa thì việc nặng hơn, hòa nữa thì theo
 * thứ tự Fisher-Yates; giao cho người có tải thấp nhất. `null` nếu bế tắc.
 */
function greedyBlocks(core: Core): Record<string, string> | null {
  let remaining = fisherYates(core.chores, core.rnd);
  const load = { ...core.load };
  const local: Local = new Map();
  const out: Record<string, string> = {};
  while (remaining.length > 0) {
    let pick: { chore: BlockChore; cands: string[] } | null = null;
    for (const chore of remaining) {
      const cands = candidates(core, local, chore);
      if (cands.length === 0) return null;
      if (!pick || cands.length < pick.cands.length || (cands.length === pick.cands.length && chore.weight > pick.chore.weight)) {
        pick = { chore, cands };
      }
    }
    const { chore, cands } = pick!;
    const m = cands.reduce((best, x) => ((load[x] ?? 0) < (load[best] ?? 0) ? x : best), cands[0]);
    out[chore.id] = m;
    load[m] = (load[m] ?? 0) + chore.weight;
    place(local, m, chore, 1);
    remaining = remaining.filter((c) => c !== chore);
  }
  return out;
}

/** Vét cạn có giới hạn nút: bắt buộc có vì greedy + retry không đảm bảo tìm ra nghiệm ở ca chặt. */
function backtrackBlocks(core: Core, nodeLimit = BACKTRACK_NODE_LIMIT): Record<string, string> | null {
  const order = [...core.chores].sort(
    (a, b) => (core.eligible[a.id]?.length ?? 0) - (core.eligible[b.id]?.length ?? 0) || b.weight - a.weight,
  );
  const load = { ...core.load };
  const local: Local = new Map();
  const out: Record<string, string> = {};
  let nodes = 0;
  const dfs = (i: number): boolean => {
    if (i === order.length) return true;
    if (++nodes > nodeLimit) return false;
    const chore = order[i];
    const cands = candidates(core, local, chore).sort((a, b) => (load[a] ?? 0) - (load[b] ?? 0));
    for (const m of cands) {
      out[chore.id] = m;
      load[m] = (load[m] ?? 0) + chore.weight;
      place(local, m, chore, 1);
      if (dfs(i + 1)) return true;
      place(local, m, chore, -1);
      load[m] -= chore.weight;
      delete out[chore.id];
    }
    return false;
  };
  return dfs(0) ? out : null;
}

function capOverflow(core: Pick<Core, 'dayCount' | 'cap'>, chores: readonly BlockChore[], assignment: Record<string, string>): number {
  const counts: Local = new Map();
  for (const c of chores) place(counts, assignment[c.id], c, 1);
  let over = 0;
  for (const [k, n] of counts) {
    const [m, d] = k.split('|');
    if (core.dayCount(m, d) + n > core.cap) over++;
  }
  return over;
}

/**
 * Phương án cuối khi mọi cấp vô nghiệm: 200 lần ngẫu nhiên, chọn ít cặp (người, việc) bị cấm nhất,
 * rồi ít vượt cap nhất, rồi chênh tải nhỏ nhất. Luôn giao đủ mọi việc có người đủ điều kiện.
 */
export function minViolation(core: Core): Record<string, string> {
  let best: { out: Record<string, string>; score: [number, number, number] } | null = null;
  for (let attempt = 0; attempt < GREEDY_ATTEMPTS; attempt++) {
    const order = fisherYates(core.chores, core.rnd).sort((a, b) => b.weight - a.weight);
    const load = { ...core.load };
    const local: Local = new Map();
    const out: Record<string, string> = {};
    let violations = 0;
    for (const chore of order) {
      const ranked = fisherYates(core.eligible[chore.id] ?? [], core.rnd)
        .map((m) => ({
          m,
          v: Number(core.forbidden.has(`${m}|${chore.id}`)),
          o: Number(!capOk(core, local, m, chore)),
          l: load[m] ?? 0,
        }))
        .sort((a, b) => a.v - b.v || a.o - b.o || a.l - b.l);
      if (ranked.length === 0) continue;
      const pick = ranked[0];
      out[chore.id] = pick.m;
      violations += pick.v;
      load[pick.m] = (load[pick.m] ?? 0) + chore.weight;
      place(local, pick.m, chore, 1);
    }
    const loads = Object.values(load);
    const score: [number, number, number] = [violations, capOverflow(core, core.chores.filter((c) => c.id in out), out), Math.max(...loads) - Math.min(...loads)];
    if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && (score[1] < best.score[1] || (score[1] === best.score[1] && score[2] < best.score[2])))) {
      best = { out, score };
    }
  }
  return best?.out ?? {};
}

/**
 * Giải các việc WEEK_BLOCK theo thứ tự nới dần: rào đầy đủ → ... → không rào (cấp 0 của `fence`),
 * mỗi cấp thử greedy 200 lần rồi vét cạn. Giữ giới hạn số ca/ngày trước; chỉ khi mọi cấp vô nghiệm mới
 * bỏ giới hạn đó (S-01: nhà 1 người). Cuối cùng mới tới `minViolation`.
 */
export function solveWeekBlocks(p: SolveParams): BlockSolveResult {
  const levels = [...new Set([p.wEff - 1, 1, 0])].filter((l) => l <= p.wEff - 1).sort((a, b) => b - a);
  let attempts = 0;

  for (const cap of [p.cap, Number.POSITIVE_INFINITY]) {
    for (const [levelIndex, lookback] of levels.entries()) {
      const core: Core = { ...p, forbidden: p.fence(lookback), cap };
      let solved: Record<string, string> | null = null;
      for (let k = 0; k < GREEDY_ATTEMPTS && !solved; k++) {
        attempts++;
        solved = greedyBlocks(core);
      }
      attempts++;
      solved ??= backtrackBlocks(core);
      if (solved) {
        const capExceeded = cap !== p.cap && capOverflow(p, p.chores, solved) > 0;
        return { assignment: solved, levelIndex, attempts, capExceeded, minViolation: false };
      }
    }
  }

  const core: Core = { ...p, forbidden: p.fence(p.wEff - 1) };
  const assignment = minViolation(core);
  return {
    assignment,
    levelIndex: levels.length,
    attempts,
    capExceeded: capOverflow(p, p.chores.filter((c) => c.id in assignment), assignment) > 0,
    minViolation: true,
  };
}

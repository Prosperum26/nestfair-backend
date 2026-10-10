export interface RotationChore {
  id: string;
  weight: number;
}

/** weekIndex tăng dần; tuần đang xếp là (weekIndex lớn nhất + 1). */
export interface HistoryEntry {
  weekIndex: number;
  choreId: string;
  memberId: string;
}

export interface RotationInput {
  memberIds: string[];
  chores: RotationChore[];
  history: HistoryEntry[];
  /** Chỉ số của tuần đang xếp. Mặc định: weekIndex lớn nhất trong history + 1. */
  currentWeekIndex?: number;
  /** Tải đã có sẵn trong tuần đang xếp (vd. ca đã nộp được giữ lại khi Shuffle). */
  extraLoad?: Record<string, number>;
  rng?: () => number;
  maxAttempts?: number;
}

export interface RotationResult {
  assignments: { choreId: string; memberId: string }[];
  /** true nếu phải nới rào 3 tuần. */
  relaxed: boolean;
  /** 3 = rào 3 tuần, 2 = rào 2 tuần, 1 = shuffle thường. */
  windowUsed: 3 | 2 | 1;
}

const DEFAULT_MAX_ATTEMPTS = 200;
const WINDOWS = [3, 2, 1] as const;

/** Fisher-Yates trên bản sao, không đổi mảng gốc. */
export function fisherYates<T>(
  items: readonly T[],
  rng: () => number = Math.random,
): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/**
 * Xếp việc cho một tuần.
 * Cửa sổ `w`: người nhận việc X không được đã làm X trong `w - 1` tuần liền trước.
 * Mỗi lần thử: xáo việc bằng Fisher-Yates (R-FAIR-3), gán cho ngẫu nhiên một người
 * hợp lệ đang có ít việc nhất trong tuần; giữ phương án có chênh lệch tải tích lũy
 * (lịch sử + tuần này) nhỏ nhất (R-FAIR-2). Hết `maxAttempts` mà vô nghiệm thì nới cửa sổ.
 */
export function generateWeekSchedule(input: RotationInput): RotationResult {
  const { memberIds, chores, history } = input;
  const rng = input.rng ?? Math.random;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (memberIds.length === 0) throw new Error('NO_MEMBERS');
  if (chores.length === 0) throw new Error('NO_CHORES');

  const weightOf = new Map(chores.map((c) => [c.id, c.weight]));
  const newWeek =
    input.currentWeekIndex ??
    history.reduce((max, h) => Math.max(max, h.weekIndex), -1) + 1;

  const baseLoad = new Map(memberIds.map((m) => [m, input.extraLoad?.[m] ?? 0]));
  for (const h of history) {
    if (baseLoad.has(h.memberId)) {
      baseLoad.set(h.memberId, baseLoad.get(h.memberId)! + (weightOf.get(h.choreId) ?? 0));
    }
  }

  for (const window of WINDOWS) {
    const forbidden = new Set(
      history
        .filter((h) => h.weekIndex >= newWeek - (window - 1))
        .map((h) => `${h.memberId}|${h.choreId}`),
    );

    let best: { assignments: RotationResult['assignments']; score: number } | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      const count = new Map(memberIds.map((m) => [m, 0]));
      const load = new Map(baseLoad);
      const assignments: RotationResult['assignments'] = [];
      let ok = true;

      for (const chore of fisherYates(chores, rng)) {
        const allowed = memberIds.filter((m) => !forbidden.has(`${m}|${chore.id}`));
        if (allowed.length === 0) {
          ok = false;
          break;
        }
        const fewest = Math.min(...allowed.map((m) => count.get(m)!));
        const pool = allowed.filter((m) => count.get(m) === fewest);
        const memberId = pool[Math.floor(rng() * pool.length)];
        assignments.push({ choreId: chore.id, memberId });
        count.set(memberId, count.get(memberId)! + 1);
        load.set(memberId, load.get(memberId)! + chore.weight);
      }
      if (!ok) continue;

      const score = spread([...load.values()]);
      if (!best || score < best.score) best = { assignments, score };
      if (best.score <= 1) break;
    }

    if (best) {
      return { assignments: best.assignments, relaxed: window !== 3, windowUsed: window };
    }
  }

  // Cửa sổ 1 không có ràng buộc nên luôn có nghiệm; nhánh này chỉ để thỏa kiểu.
  throw new Error('NO_SCHEDULE');
}

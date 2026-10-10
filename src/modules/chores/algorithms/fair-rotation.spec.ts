import { describe, expect, it } from 'vitest';
import {
  fisherYates,
  generateWeekSchedule,
  type HistoryEntry,
  type RotationChore,
} from './fair-rotation.js';

/** RNG xác định (mulberry32) để test lặp lại được. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MEMBERS = ['m1', 'm2', 'm3', 'm4'];
const CHORES: RotationChore[] = [
  { id: 'c1', weight: 2 },
  { id: 'c2', weight: 2 },
  { id: 'c3', weight: 3 },
  { id: 'c4', weight: 3 },
];

function simulate(
  seed: number,
  weeks: number,
  members = MEMBERS,
  chores = CHORES,
) {
  const rng = seeded(seed);
  const history: HistoryEntry[] = [];
  const results = [];
  for (let w = 0; w < weeks; w++) {
    const res = generateWeekSchedule({ memberIds: members, chores, history, rng });
    results.push(res);
    for (const a of res.assignments) history.push({ weekIndex: w, ...a });
  }
  return { history, results };
}

function loadSpread(history: HistoryEntry[], chores: RotationChore[], members: string[]) {
  const weight = new Map(chores.map((c) => [c.id, c.weight]));
  const load = new Map(members.map((m) => [m, 0]));
  for (const h of history) load.set(h.memberId, load.get(h.memberId)! + (weight.get(h.choreId) ?? 0));
  const values = [...load.values()];
  return Math.max(...values) - Math.min(...values);
}

describe('fisherYates', () => {
  it('giữ nguyên phần tử và không đổi mảng gốc', () => {
    const src = [1, 2, 3, 4, 5, 6];
    const out = fisherYates(src, seeded(7));
    expect([...out].sort((a, b) => a - b)).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('cùng seed cho cùng thứ tự', () => {
    const src = ['a', 'b', 'c', 'd', 'e'];
    expect(fisherYates(src, seeded(42))).toEqual(fisherYates(src, seeded(42)));
  });
});

describe('generateWeekSchedule', () => {
  it('4 người × 4 việc, chưa có lịch sử: mỗi việc 1 chủ, mỗi người 1 việc, không relaxed', () => {
    const res = generateWeekSchedule({ memberIds: MEMBERS, chores: CHORES, history: [], rng: seeded(1) });
    expect(res.relaxed).toBe(false);
    expect(res.windowUsed).toBe(3);
    expect(res.assignments.map((a) => a.choreId).sort()).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(res.assignments.map((a) => a.memberId).sort()).toEqual(MEMBERS);
  });

  it('không ai nhận lại việc đã làm ở 2 tuần trước', () => {
    const { history } = simulate(5, 2);
    const res = generateWeekSchedule({ memberIds: MEMBERS, chores: CHORES, history, rng: seeded(9) });
    for (const a of res.assignments) {
      expect(history.some((h) => h.memberId === a.memberId && h.choreId === a.choreId)).toBe(false);
    }
  });

  it('nghiệm thu: 100 lần × 6 tuần × 4 người × 4 việc đạt R-FAIR-1 và Δ tải ≤ 2', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { history, results } = simulate(seed, 6);
      expect(results.every((r) => !r.relaxed)).toBe(true);
      for (let start = 0; start + 2 < 6; start++) {
        const seen = new Set<string>();
        for (const h of history.filter((x) => x.weekIndex >= start && x.weekIndex <= start + 2)) {
          const key = `${h.memberId}|${h.choreId}`;
          expect(seen.has(key), `seed ${seed} tuần ${start}: ${key} lặp trong cửa sổ 3 tuần`).toBe(false);
          seen.add(key);
        }
      }
      expect(loadSpread(history, CHORES, MEMBERS), `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it('nhiều việc hơn người: mọi việc có chủ, số việc mỗi người chênh nhau ≤ 1', () => {
    const chores = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, weight: 1 }));
    const members = ['x', 'y', 'z'];
    const res = generateWeekSchedule({ memberIds: members, chores, history: [], rng: seeded(3) });
    expect(res.assignments).toHaveLength(5);
    const counts = members.map((m) => res.assignments.filter((a) => a.memberId === m).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('nhiều người hơn việc: không ai bị gán 2 việc', () => {
    const members = ['a', 'b', 'c', 'd', 'e'];
    const chores = [{ id: 'c1', weight: 1 }, { id: 'c2', weight: 1 }];
    const res = generateWeekSchedule({ memberIds: members, chores, history: [], rng: seeded(4) });
    expect(new Set(res.assignments.map((a) => a.memberId)).size).toBe(2);
  });

  it('vô nghiệm ở cửa sổ 3: nới xuống 2 tuần và báo relaxed', () => {
    const chores = [{ id: 'A', weight: 1 }, { id: 'B', weight: 1 }];
    const history: HistoryEntry[] = [
      { weekIndex: 0, choreId: 'A', memberId: 'm1' },
      { weekIndex: 0, choreId: 'B', memberId: 'm2' },
      { weekIndex: 1, choreId: 'B', memberId: 'm1' },
      { weekIndex: 1, choreId: 'A', memberId: 'm2' },
    ];
    const res = generateWeekSchedule({ memberIds: ['m1', 'm2'], chores, history, rng: seeded(1) });
    expect(res.relaxed).toBe(true);
    expect(res.windowUsed).toBe(2);
    expect(res.assignments).toHaveLength(2);
  });

  it('một người một việc lặp lại: bỏ ràng buộc, relaxed, không crash', () => {
    const res = generateWeekSchedule({
      memberIds: ['solo'],
      chores: [{ id: 'A', weight: 2 }],
      history: [{ weekIndex: 0, choreId: 'A', memberId: 'solo' }],
      rng: seeded(1),
    });
    expect(res.windowUsed).toBe(1);
    expect(res.relaxed).toBe(true);
    expect(res.assignments).toEqual([{ choreId: 'A', memberId: 'solo' }]);
  });

  it('ném NO_MEMBERS / NO_CHORES khi rỗng', () => {
    expect(() => generateWeekSchedule({ memberIds: [], chores: CHORES, history: [] })).toThrow('NO_MEMBERS');
    expect(() => generateWeekSchedule({ memberIds: MEMBERS, chores: [], history: [] })).toThrow('NO_CHORES');
  });

  it('currentWeekIndex tường minh: tuần trống ở giữa không làm lịch sử bị tính nhầm là tuần liền trước', () => {
    const res = generateWeekSchedule({
      memberIds: ['solo'],
      chores: [{ id: 'A', weight: 2 }],
      history: [{ weekIndex: 0, choreId: 'A', memberId: 'solo' }],
      currentWeekIndex: 5,
      rng: seeded(1),
    });
    expect(res.windowUsed).toBe(3);
    expect(res.relaxed).toBe(false);
  });

  it('extraLoad: người đã gánh sẵn nhiều thì nhận việc nhẹ hơn', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const res = generateWeekSchedule({
        memberIds: ['m1', 'm2'],
        chores: [{ id: 'heavy', weight: 3 }, { id: 'light', weight: 1 }],
        history: [],
        extraLoad: { m1: 5 },
        rng: seeded(seed),
      });
      expect(res.assignments.find((a) => a.choreId === 'heavy')!.memberId).toBe('m2');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { blockChore, blockPairsBefore, members, perChore, simulate } from './test-helpers.js';
import { generateWeek } from './schedule-generator.js';

const WEIGHTS = [2, 2, 3, 3, 1, 4, 2, 5];
const blocks = (c: number) => Array.from({ length: c }, (_, i) => blockChore(`c${i + 1}`, WEIGHTS[i % WEIGHTS.length]));
const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);

describe('T-01: không relaxed, đúng rào W_eff, mọi slot có chủ (100 seed × 6 tuần)', () => {
  const configs: [number, number][] = [
    [4, 4],
    [3, 3],
    [5, 3],
    [8, 3],
    [4, 2],
    [3, 1],
  ];
  for (const [n, c] of configs) {
    it(`(N=${n}, C=${c})`, () => {
      const chores = blocks(c);
      const ids = new Set(chores.map((x) => x.id));
      const wEff = Math.min(3, n);
      for (const seed of SEEDS) {
        const { results } = simulate({ members: members(n), chores, weeks: 6, seed });
        results.forEach((res, w) => {
          expect(res.relaxed, `seed ${seed} tuần ${w}`).toBe(false);
          expect(res.fenceWeeksApplied).toBe(wEff);
          const banned = blockPairsBefore(results, w, wEff - 1, ids);
          const perPerson: Record<string, number> = {};
          for (const s of res.slots) {
            expect(s.memberId, `seed ${seed} tuần ${w} ${s.choreId}`).not.toBeNull();
            expect(banned.has(`${s.memberId}|${s.choreId}`), `seed ${seed} tuần ${w}: ${s.memberId} lặp ${s.choreId}`).toBe(false);
            perPerson[s.memberId!] = (perPerson[s.memberId!] ?? 0) + 1;
          }
          // H3: cùng một ngày (tất cả việc đều rơi Chủ Nhật) không ai quá 2 ca khi còn người khác.
          if (c <= 2 * n) expect(Math.max(...Object.values(perPerson))).toBeLessThanOrEqual(2);
        });
      }
    });
  }
});

describe('T-02: nhà 2 người, rào luân phiên (không làm cùng việc 2 tuần liền)', () => {
  const configs: [number, number][] = [
    [2, 4],
    [2, 1],
    [2, 3],
  ];
  for (const [n, c] of configs) {
    it(`(N=${n}, C=${c})`, () => {
      const chores = blocks(c);
      const ids = new Set(chores.map((x) => x.id));
      for (const seed of SEEDS) {
        const { results } = simulate({ members: members(n), chores, weeks: 6, seed });
        results.forEach((res, w) => {
          expect(res.fenceWeeksApplied).toBe(2);
          expect(res.relaxed, `seed ${seed} tuần ${w}`).toBe(false);
          expect(res.reasons).toContain('SMALL_HOUSE');
          const banned = blockPairsBefore(results, w, 1, ids);
          for (const s of res.slots) expect(banned.has(`${s.memberId}|${s.choreId}`), `seed ${seed} tuần ${w}`).toBe(false);
        });
      }
    });
  }
});

describe('T-03: nhà 1 người', () => {
  it('giao mọi ca cho người đó, SOLO_HOUSE, không relaxed', () => {
    for (const seed of SEEDS) {
      const { results } = simulate({ members: members(1), chores: blocks(2), weeks: 6, seed });
      for (const res of results) {
        expect(res.reasons).toContain('SOLO_HOUSE');
        expect(res.relaxed).toBe(false);
        expect(res.slots.every((s) => s.memberId === 'm1')).toBe(true);
      }
    }
  });
});

describe('T-04: ca chặt (3,6) và (3,5)', () => {
  for (const c of [6, 5]) {
    it(`(N=3, C=${c}): hoặc đạt rào, hoặc relaxed kèm FEW_OPTIONS; không crash, mọi slot có chủ`, () => {
      const chores = blocks(c);
      const ids = new Set(chores.map((x) => x.id));
      for (const seed of SEEDS) {
        const { results } = simulate({ members: members(3), chores, weeks: 6, seed });
        results.forEach((res, w) => {
          expect(res.slots.every((s) => s.memberId !== null)).toBe(true);
          if (!res.relaxed) {
            const banned = blockPairsBefore(results, w, 2, ids);
            for (const s of res.slots) expect(banned.has(`${s.memberId}|${s.choreId}`)).toBe(false);
          } else {
            expect(res.relaxLevel).toBeGreaterThan(0);
            expect(res.reasons).toContain('FEW_OPTIONS');
          }
        });
      }
    });
  }
});

describe('T-05: PER_OCCURRENCE hằng ngày', () => {
  for (const n of [2, 3, 4, 5]) {
    it(`N=${n}: không ai làm 2 ngày liền (kể cả qua tuần), chênh số ca ≤ 1`, () => {
      for (const seed of SEEDS.slice(0, 40)) {
        const { results } = simulate({ members: members(n), chores: [perChore('trash', 2)], weeks: 6, seed });
        const all: string[] = [];
        for (const res of results) {
          const counts = new Map<string, number>();
          for (const s of res.slots) {
            all.push(s.memberId!);
            counts.set(s.memberId!, (counts.get(s.memberId!) ?? 0) + 1);
          }
          const values = Array.from({ length: n }, (_, i) => counts.get(`m${i + 1}`) ?? 0);
          expect(Math.max(...values) - Math.min(...values), `N=${n} seed=${seed}`).toBeLessThanOrEqual(1);
        }
        for (let i = 1; i < all.length; i++) expect(all[i], `N=${n} seed=${seed} i=${i}`).not.toBe(all[i - 1]);
      }
    });
  }
});

describe('T-06: qua năm ISO có tuần 53', () => {
  it('ngày của slot đúng qua 2026-W53 → 2027-W01', () => {
    const { results, weekStarts } = simulate({
      members: members(3),
      chores: [blockChore('a', 2, [1]), blockChore('b', 2, [7])],
      weeks: 4,
      seed: 5,
      startWeek: '2026-12-21',
    });
    expect(weekStarts).toEqual(['2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11']);
    expect(results[1].slots.find((s) => s.choreId === 'a')!.occurrenceDate).toBe('2026-12-28');
    expect(results[1].slots.find((s) => s.choreId === 'b')!.occurrenceDate).toBe('2027-01-03');
    expect(results[2].slots.find((s) => s.choreId === 'a')!.occurrenceDate).toBe('2027-01-04');
  });
});

describe('T-07: tái lập', () => {
  it('cùng seed + đầu vào cho kết quả giống hệt, seed khác thường khác', () => {
    const run = (seed: number) => simulate({ members: members(4), chores: blocks(4), weeks: 1, seed }).results[0].slots;
    expect(run(7)).toEqual(run(7));
    const distinct = new Set(SEEDS.slice(0, 20).map((s) => JSON.stringify(run(s))));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('T-11: cân bằng tải 12 tuần (N=4, weight 1..4)', () => {
  it('chênh tải tích lũy ≤ 2 × weight lớn nhất', () => {
    const chores = [1, 2, 3, 4].map((w) => blockChore(`w${w}`, w));
    for (const seed of SEEDS.slice(0, 30)) {
      const { results } = simulate({ members: members(4), chores, weeks: 12, seed });
      const load: Record<string, number> = { m1: 0, m2: 0, m3: 0, m4: 0 };
      for (const res of results) for (const s of res.slots) load[s.memberId!] += chores.find((c) => c.id === s.choreId)!.weight;
      const v = Object.values(load);
      expect(Math.max(...v) - Math.min(...v), `seed ${seed}`).toBeLessThanOrEqual(8);
    }
  });
});

describe('T-12: hiệu năng', () => {
  it('8 người × 20 việc sinh lịch < 100 ms (trung vị 5 lần)', () => {
    const chores = [
      ...Array.from({ length: 12 }, (_, i) => blockChore(`b${i}`, 1 + (i % 5), [1 + (i % 7)])),
      ...Array.from({ length: 8 }, (_, i) => perChore(`p${i}`, 1 + (i % 5), [1, 3, 5])),
    ];
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      generateWeek({
        seed: k + 1,
        weekStart: '2026-10-05',
        houseBreakDates: new Set(),
        maxSlotsPerDay: 2,
        members: members(8),
        chores,
        history: [],
        prevTail: {},
        pinned: [],
      });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(100);
  });
});

import { describe, expect, it } from 'vitest';
import { type BlockChore, minViolation, solveWeekBlocks } from './week-block.js';
import { fisherYates, mulberry32 } from './rng.js';

const D = '2026-10-11';
const chore = (id: string, weight = 2, dates = [D]): BlockChore => ({ id, weight, dates });
const none = () => 0;
const forbidAll = (pairs: string[]) => () => new Set(pairs);

function base(over: Partial<Parameters<typeof solveWeekBlocks>[0]> = {}) {
  return {
    chores: [] as BlockChore[],
    eligible: {} as Record<string, string[]>,
    fence: (_lookback: number) => new Set<string>(),
    wEff: 3,
    load: {} as Record<string, number>,
    dayCount: none as (m: string, d: string) => number,
    cap: 2,
    rnd: mulberry32(1),
    ...over,
  };
}

describe('solveWeekBlocks', () => {
  it('(3,3) lịch sử 2 tuần: đúng một phương án hợp lệ, tìm ra ở cấp rào đầy đủ', () => {
    const members = ['m1', 'm2', 'm3'];
    const chores = ['c1', 'c2', 'c3'].map((id) => chore(id));
    const forbidden = new Set(['m1|c1', 'm2|c2', 'm3|c3', 'm1|c2', 'm2|c3', 'm3|c1']);
    for (let seed = 1; seed <= 30; seed++) {
      const res = solveWeekBlocks(
        base({
          chores,
          eligible: Object.fromEntries(chores.map((c) => [c.id, members])),
          fence: forbidAll([...forbidden]),
          load: { m1: 0, m2: 0, m3: 0 },
          rnd: mulberry32(seed),
        }),
      );
      expect(res.levelIndex).toBe(0);
      expect(res.assignment).toEqual({ c3: 'm1', c1: 'm2', c2: 'm3' });
    }
  });

  it('ca chặt: 200 bài toán có nghiệm chắc chắn tồn tại (gieo sẵn) đều giải được ở cấp 0', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = mulberry32(seed);
      const n = 3 + (seed % 3);
      const members = Array.from({ length: n }, (_, i) => `m${i}`);
      const chores = Array.from({ length: 2 * n }, (_, i) => chore(`c${i}`, 1 + (i % 5)));
      // Gieo nghiệm: mỗi người đúng 2 việc.
      const shuffled = fisherYates(chores.map((c) => c.id), rnd);
      const planted = new Map(shuffled.map((c, i) => [c, members[i % n]]));
      const forbidden = new Set<string>();
      for (const m of members) for (const c of chores) if (planted.get(c.id) !== m && rnd() < 0.6) forbidden.add(`${m}|${c.id}`);
      const res = solveWeekBlocks(
        base({
          chores,
          eligible: Object.fromEntries(chores.map((c) => [c.id, members])),
          fence: forbidAll([...forbidden]),
          load: Object.fromEntries(members.map((m) => [m, 0])),
          cap: 99,
          rnd,
        }),
      );
      expect(res.levelIndex, `seed ${seed}`).toBe(0);
      expect(res.minViolation).toBe(false);
      for (const c of chores) expect(forbidden.has(`${res.assignment[c.id]}|${c.id}`), `seed ${seed} ${c.id}`).toBe(false);
    }
  });

  it('vô nghiệm ở cấp đầy đủ thì nới xuống cấp sau và báo levelIndex > 0', () => {
    const res = solveWeekBlocks(
      base({
        chores: [chore('c1')],
        eligible: { c1: ['m1', 'm2'] },
        wEff: 2,
        fence: (lookback) => (lookback >= 1 ? new Set(['m1|c1', 'm2|c1']) : new Set()),
        load: { m1: 0, m2: 0 },
      }),
    );
    expect(res.levelIndex).toBe(1);
    expect(['m1', 'm2']).toContain(res.assignment.c1);
  });

  it('wEff = 1 (nhà 1 người) chỉ có cấp 0, không bao giờ coi là nới', () => {
    const res = solveWeekBlocks(base({ chores: [chore('c1')], eligible: { c1: ['solo'] }, wEff: 1, load: { solo: 0 } }));
    expect(res.levelIndex).toBe(0);
    expect(res.assignment).toEqual({ c1: 'solo' });
  });

  it('việc nặng giao cho người tải tích lũy thấp hơn', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const res = solveWeekBlocks(
        base({
          chores: [chore('heavy', 5), chore('light', 1)],
          eligible: { heavy: ['m1', 'm2'], light: ['m1', 'm2'] },
          load: { m1: 0, m2: 10 },
          cap: 99,
          rnd: mulberry32(seed),
        }),
      );
      expect(res.assignment.heavy).toBe('m1');
    }
  });

  it('chỉ giao cho người đủ điều kiện (không vắng)', () => {
    const res = solveWeekBlocks(
      base({ chores: [chore('c1')], eligible: { c1: ['m2'] }, load: { m1: 0, m2: 0 } }),
    );
    expect(res.assignment.c1).toBe('m2');
  });

  it('H3: không ai vượt số ca/ngày khi còn người khác', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const chores = ['a', 'b', 'c', 'd'].map((id) => chore(id));
      const res = solveWeekBlocks(
        base({
          chores,
          eligible: Object.fromEntries(chores.map((c) => [c.id, ['m1', 'm2']])),
          load: { m1: 0, m2: 0 },
          cap: 2,
          rnd: mulberry32(seed),
        }),
      );
      const counts = { m1: 0, m2: 0 } as Record<string, number>;
      for (const m of Object.values(res.assignment)) counts[m]++;
      expect(counts).toEqual({ m1: 2, m2: 2 });
      expect(res.capExceeded).toBe(false);
    }
  });

  it('S-01: không còn ai khác thì vẫn giao hết và báo capExceeded (không coi là vô nghiệm)', () => {
    const chores = ['a', 'b', 'c', 'd'].map((id) => chore(id));
    const res = solveWeekBlocks(
      base({
        chores,
        eligible: Object.fromEntries(chores.map((c) => [c.id, ['solo']])),
        wEff: 1,
        load: { solo: 0 },
        cap: 2,
      }),
    );
    expect(Object.values(res.assignment)).toEqual(['solo', 'solo', 'solo', 'solo']);
    expect(res.capExceeded).toBe(true);
    expect(res.minViolation).toBe(false);
  });

  it('tái lập theo seed', () => {
    const chores = ['a', 'b', 'c'].map((id) => chore(id, 2));
    const run = (seed: number) =>
      solveWeekBlocks(base({ chores, eligible: Object.fromEntries(chores.map((c) => [c.id, ['m1', 'm2', 'm3']])), load: { m1: 0, m2: 0, m3: 0 }, rnd: mulberry32(seed) })).assignment;
    expect(run(5)).toEqual(run(5));
  });
});

describe('minViolation', () => {
  it('luôn giao đủ mọi việc và chọn phương án ít cặp bị cấm nhất', () => {
    const chores = [chore('c1'), chore('c2')];
    const forbidden = new Set(['m1|c1', 'm1|c2', 'm2|c1']); // chỉ m2|c2 hợp lệ; m1 buộc phải nhận một việc bị cấm
    const out = minViolation({
      chores,
      eligible: { c1: ['m1', 'm2'], c2: ['m1', 'm2'] },
      forbidden,
      load: { m1: 0, m2: 0 },
      dayCount: none,
      cap: 99,
      rnd: mulberry32(2),
    });
    expect(Object.keys(out).sort()).toEqual(['c1', 'c2']);
    const violations = chores.filter((c) => forbidden.has(`${out[c.id]}|${c.id}`)).length;
    expect(violations).toBe(1);
  });
});

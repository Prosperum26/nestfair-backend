import { describe, expect, it } from 'vitest';
import { blockSequence } from './per-occurrence.js';
import { mulberry32 } from './rng.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
const zero = (members: string[]) => Object.fromEntries(members.map((m) => [m, 0]));

describe('blockSequence', () => {
  it('T-05: 7 ngày, N 2..5, 6 tuần liền: không ai làm 2 lần liên tiếp (kể cả qua tuần), chênh số ca ≤ 1', () => {
    for (const n of [2, 3, 4, 5]) {
      const members = ids(n);
      for (let seed = 1; seed <= 50; seed++) {
        const rnd = mulberry32(seed);
        const load = zero(members);
        let prev: string | null = null;
        const all: string[] = [];
        for (let week = 0; week < 6; week++) {
          const seq = blockSequence({ memberIds: members, length: 7, prev, load, gap: 1, rnd });
          expect(seq).toHaveLength(7);
          const counts = members.map((m) => seq.filter((x) => x === m).length);
          expect(Math.max(...counts) - Math.min(...counts), `N=${n} seed=${seed} week=${week}`).toBeLessThanOrEqual(1);
          for (const m of seq) load[m] += 1;
          all.push(...seq);
          prev = seq.at(-1)!;
        }
        for (let i = 1; i < all.length; i++) {
          expect(all[i], `N=${n} seed=${seed} i=${i}`).not.toBe(all[i - 1]);
        }
      }
    }
  });

  it('S-03: 2 người, tuần 7 ca: người dư 1 ca đổi người ở tuần kế tiếp (chuỗi liên tục xuyên tuần)', () => {
    const members = ['m1', 'm2'];
    const rnd = mulberry32(3);
    const week1 = blockSequence({ memberIds: members, length: 7, prev: null, load: zero(members), gap: 1, rnd });
    const week2 = blockSequence({ memberIds: members, length: 7, prev: week1.at(-1)!, load: zero(members), gap: 1, rnd });
    const extra = (seq: string[]) => (seq.filter((x) => x === 'm1').length === 4 ? 'm1' : 'm2');
    expect(extra(week1)).not.toBe(extra(week2));
  });

  it('khối dở (7 mod N) giao cho người có tải tích lũy thấp nhất', () => {
    // N=3: 2 khối đủ + 1 ca dư. Người tải thấp nhất (m3) phải là người nhận ca dư (làm 3 ca).
    const members = ['m1', 'm2', 'm3'];
    for (let seed = 1; seed <= 30; seed++) {
      const seq = blockSequence({ memberIds: members, length: 7, prev: null, load: { m1: 5, m2: 5, m3: 0 }, gap: 1, rnd: mulberry32(seed) });
      expect(seq.filter((x) => x === 'm3'), `seed ${seed}`).toHaveLength(3);
    }
  });

  it('gap = 2: không ai lặp trong 2 vị trí liền, phần tử đầu khác prev', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const members = ids(4);
      const seq = blockSequence({ memberIds: members, length: 7, prev: 'm1', load: zero(members), gap: 2, rnd: mulberry32(seed) });
      expect(seq[0], `seed ${seed}`).not.toBe('m1');
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i]).not.toBe(seq[i - 1]);
        if (i >= 2) expect(seq[i]).not.toBe(seq[i - 2]);
      }
    }
  });

  it('một người: giao hết cho người đó, không crash', () => {
    expect(blockSequence({ memberIds: ['solo'], length: 3, prev: 'solo', load: { solo: 0 }, gap: 1, rnd: mulberry32(1) })).toEqual([
      'solo',
      'solo',
      'solo',
    ]);
  });

  it('độ dài 0 hoặc không có ai thì trả mảng rỗng', () => {
    expect(blockSequence({ memberIds: ['a', 'b'], length: 0, prev: null, load: { a: 0, b: 0 }, gap: 1, rnd: mulberry32(1) })).toEqual([]);
    expect(blockSequence({ memberIds: [], length: 3, prev: null, load: {}, gap: 1, rnd: mulberry32(1) })).toEqual([]);
  });

  it('tái lập theo seed', () => {
    const members = ids(4);
    const run = () => blockSequence({ memberIds: members, length: 7, prev: null, load: zero(members), gap: 1, rnd: mulberry32(11) });
    expect(run()).toEqual(run());
  });
});

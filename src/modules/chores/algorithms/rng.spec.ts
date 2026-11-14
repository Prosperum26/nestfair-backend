import { describe, expect, it } from 'vitest';
import { fisherYates, mulberry32 } from './rng.js';

describe('mulberry32', () => {
  it('cùng seed cho cùng dãy, seed khác cho dãy khác', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([b(), b(), b()]);
    expect(seqA).not.toEqual([mulberry32(43)(), mulberry32(43)(), mulberry32(43)()]);
  });

  it('giá trị nằm trong [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('fisherYates', () => {
  it('giữ nguyên phần tử, không đổi mảng gốc, tái lập theo seed', () => {
    const src = [1, 2, 3, 4, 5, 6];
    const out = fisherYates(src, mulberry32(9));
    expect([...out].sort((x, y) => x - y)).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
    expect(fisherYates(src, mulberry32(9))).toEqual(out);
  });
});

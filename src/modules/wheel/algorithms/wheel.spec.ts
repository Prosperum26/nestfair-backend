import { describe, expect, it, vi } from 'vitest';
import { buildSlices, pickLandingIndex, pickWinner, sliceCount } from './wheel.js';

const people = (n: number) => Array.from({ length: n }, (_, i) => `u${i + 1}`);

describe('pickWinner', () => {
  it('luôn trả một người trong danh sách tham gia', () => {
    const ids = people(4);
    for (let i = 0; i < 500; i++) expect(ids).toContain(pickWinner(ids));
  });

  it('dùng crypto.randomInt (không dùng Math.random) với cận trên là số người', () => {
    const rand = vi.fn((_min: number, _max: number) => 2);
    const spy = vi.spyOn(Math, 'random');
    expect(pickWinner(['a', 'b', 'c'], rand)).toBe('c');
    expect(rand).toHaveBeenCalledWith(0, 3);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('T-LW-01: 10.000 lần với 4 người, mỗi người trong [2.350, 2.650]', () => {
    const ids = people(4);
    const count = Object.fromEntries(ids.map((id) => [id, 0]));
    for (let i = 0; i < 10_000; i++) count[pickWinner(ids)]++;
    for (const id of ids) {
      expect(count[id]).toBeGreaterThanOrEqual(2350);
      expect(count[id]).toBeLessThanOrEqual(2650);
    }
  });

  it('dưới 2 người thì ném lỗi (chặn ở tầng service trước)', () => {
    expect(() => pickWinner(['a'])).toThrow();
  });
});

describe('sliceCount', () => {
  it('k = ceil(8 / n) lát mỗi người', () => {
    expect([2, 3, 4, 5, 8, 9, 10].map(sliceCount)).toEqual([8, 9, 8, 10, 8, 9, 10]);
  });
});

describe('buildSlices', () => {
  it('T-LW-02: 2/3/4/5/8 người → 8/9/8/10/8 lát, số lát mỗi người bằng nhau', () => {
    for (const [n, total] of [
      [2, 8],
      [3, 9],
      [4, 8],
      [5, 10],
      [8, 8],
    ]) {
      const ids = people(n);
      const slices = buildSlices(ids, 12345);
      expect(slices).toHaveLength(total);
      const per = ids.map((id) => slices.filter((s) => s === id).length);
      expect(new Set(per).size).toBe(1);
    }
  });

  it('không có hai lát cạnh nhau cùng người (kể cả vòng nối đầu - cuối)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const n of [2, 3, 4, 5, 8]) {
        const s = buildSlices(people(n), seed);
        for (let i = 0; i < s.length; i++) expect(s[i]).not.toBe(s[(i + 1) % s.length]);
      }
    }
  });

  it('cùng seed ra cùng thứ tự (client vẽ lại được), seed khác thường ra thứ tự khác', () => {
    const ids = people(4);
    expect(buildSlices(ids, 771204)).toEqual(buildSlices(ids, 771204));
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => buildSlices(ids, i + 1).join(',')));
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('pickLandingIndex', () => {
  it('T-LW-02: luôn là một lát của người trúng', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const ids = people(3);
      const slices = buildSlices(ids, seed);
      const winner = pickWinner(ids);
      expect(slices[pickLandingIndex(slices, winner)]).toBe(winner);
    }
  });

  it('chọn ngẫu nhiên giữa các lát của người trúng', () => {
    const slices = ['a', 'b', 'a', 'b', 'a', 'b'];
    const seen = new Set(Array.from({ length: 200 }, () => pickLandingIndex(slices, 'a')));
    expect([...seen].sort((x, y) => x - y)).toEqual([0, 2, 4]);
  });

  it('người trúng không có lát thì ném lỗi', () => {
    expect(() => pickLandingIndex(['a', 'b'], 'c')).toThrow();
  });
});

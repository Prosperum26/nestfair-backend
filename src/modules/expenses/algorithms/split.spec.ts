import { describe, expect, it } from 'vitest';
import { computeSplit, splitCustom, splitEqual, splitExact } from './split.js';

const sum = (shares: { amount: number }[]) => shares.reduce((s, x) => s + x.amount, 0);
const amounts = (shares: { amount: number }[]) => shares.map((s) => s.amount);

/** LCG có seed: test ngẫu nhiên nhưng tái lập được. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('splitEqual', () => {
  it('chia 100.000đ cho 3 người: phần dư 1đ cộng cho người đầu danh sách', () => {
    const shares = splitEqual(100_000, ['a', 'b', 'c']);
    expect(shares).toEqual([
      { userId: 'a', amount: 33_334 },
      { userId: 'b', amount: 33_333 },
      { userId: 'c', amount: 33_333 },
    ]);
  });

  it('phần dư lớn hơn 1đ được cộng lần lượt 1đ từ đầu danh sách', () => {
    // 10đ cho 4 người: 2đ mỗi người, dư 2đ cho 2 người đầu.
    expect(amounts(splitEqual(10, ['a', 'b', 'c', 'd']))).toEqual([3, 3, 2, 2]);
  });

  it('chia hết thì mọi người bằng nhau', () => {
    expect(amounts(splitEqual(120_000, ['a', 'b', 'c', 'd']))).toEqual([30_000, 30_000, 30_000, 30_000]);
  });

  it('một người gánh hết', () => {
    expect(splitEqual(50_000, ['a'])).toEqual([{ userId: 'a', amount: 50_000 }]);
  });

  it('giữ nguyên thứ tự userId đầu vào', () => {
    expect(splitEqual(7, ['z', 'a', 'm']).map((s) => s.userId)).toEqual(['z', 'a', 'm']);
  });

  it('1000 cặp (total, n) ngẫu nhiên: tổng luôn bằng total, lệch nhau tối đa 1đ, không phần âm', () => {
    const rand = rng(2026);
    for (let i = 0; i < 1000; i++) {
      const total = 1 + Math.floor(rand() * 5_000_000);
      const n = 1 + Math.floor(rand() * 10);
      const shares = splitEqual(total, Array.from({ length: n }, (_, k) => `u${k}`));
      expect(sum(shares), `total=${total} n=${n}`).toBe(total);
      const a = amounts(shares);
      expect(Math.max(...a) - Math.min(...a)).toBeLessThanOrEqual(1);
      expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
      expect(a.every(Number.isInteger)).toBe(true);
    }
  });

  it('total nhỏ hơn số người: một số người nhận 0đ, vẫn đủ tổng', () => {
    const shares = splitEqual(2, ['a', 'b', 'c']);
    expect(amounts(shares)).toEqual([1, 1, 0]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('từ chối total không hợp lệ: %s', (total) => {
    expect(() => splitEqual(total, ['a'])).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: 'SPLIT_INVALID' }) }));
  });

  it('từ chối danh sách người rỗng', () => {
    expect(() => splitEqual(1000, [])).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: 'SPLIT_INVALID' }) }));
  });

  it('từ chối userId trùng', () => {
    expect(() => splitEqual(1000, ['a', 'a'])).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: 'SPLIT_INVALID' }) }));
  });
});

describe('splitCustom (chọn người hưởng)', () => {
  it('chia đều trong nhóm được chọn, người không chọn không có phần', () => {
    const shares = splitCustom(100_000, ['hung', 'quan']);
    expect(shares).toEqual([
      { userId: 'hung', amount: 50_000 },
      { userId: 'quan', amount: 50_000 },
    ]);
  });
});

describe('splitExact (số tiền cố định)', () => {
  it('nhận khi tổng khớp (ví dụ "Đi chợ cuối tuần" 520.000đ)', () => {
    const input = [
      { userId: 'hung', amount: 110_000 },
      { userId: 'thien', amount: 120_000 },
      { userId: 'mai', amount: 140_000 },
      { userId: 'quan', amount: 150_000 },
    ];
    expect(splitExact(520_000, input)).toEqual(input);
  });

  it('tổng lệch thì ném SPLIT_SUM_MISMATCH (422)', () => {
    expect(() =>
      splitExact(520_000, [
        { userId: 'a', amount: 300_000 },
        { userId: 'b', amount: 200_000 },
      ]),
    ).toThrowError(expect.objectContaining({ status: 422, response: expect.objectContaining({ code: 'SPLIT_SUM_MISMATCH' }) }));
  });

  it('cho phép phần 0đ nhưng không cho phần âm hoặc lẻ', () => {
    expect(() => splitExact(100, [{ userId: 'a', amount: 100 }, { userId: 'b', amount: 0 }])).not.toThrow();
    expect(() => splitExact(100, [{ userId: 'a', amount: 150 }, { userId: 'b', amount: -50 }])).toThrowError(
      expect.objectContaining({ response: expect.objectContaining({ code: 'SPLIT_INVALID' }) }),
    );
    expect(() => splitExact(100, [{ userId: 'a', amount: 99.5 }, { userId: 'b', amount: 0.5 }])).toThrowError(
      expect.objectContaining({ response: expect.objectContaining({ code: 'SPLIT_INVALID' }) }),
    );
  });

  it('từ chối userId trùng và danh sách rỗng', () => {
    expect(() => splitExact(100, [{ userId: 'a', amount: 50 }, { userId: 'a', amount: 50 }])).toThrowError(
      expect.objectContaining({ response: expect.objectContaining({ code: 'SPLIT_INVALID' }) }),
    );
    expect(() => splitExact(100, [])).toThrowError(expect.objectContaining({ response: expect.objectContaining({ code: 'SPLIT_INVALID' }) }));
  });
});

describe('computeSplit (điểm vào chung)', () => {
  it('điều phối theo type', () => {
    expect(computeSplit({ type: 'EQUAL', total: 90, userIds: ['a', 'b', 'c'] })).toEqual(splitEqual(90, ['a', 'b', 'c']));
    expect(computeSplit({ type: 'CUSTOM', total: 90, userIds: ['a', 'b'] })).toEqual(splitCustom(90, ['a', 'b']));
    const amountsIn = [{ userId: 'a', amount: 90 }];
    expect(computeSplit({ type: 'EXACT', total: 90, amounts: amountsIn })).toEqual(amountsIn);
  });

  it('ITEMIZED chưa hỗ trợ: ném SPLIT_TYPE_NOT_SUPPORTED (422)', () => {
    expect(() => computeSplit({ type: 'ITEMIZED', total: 90 })).toThrowError(
      expect.objectContaining({ status: 422, response: expect.objectContaining({ code: 'SPLIT_TYPE_NOT_SUPPORTED' }) }),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { computeSplit, splitCustom, splitEqual, splitExact, splitItemized } from './split.js';

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

  it('ITEMIZED điều phối tới splitItemized', () => {
    const items = [{ lineTotal: 30_000, userIds: ['a', 'b'] }];
    expect(computeSplit({ type: 'ITEMIZED', total: 33_000, items, order: ['a', 'b'] })).toEqual(splitItemized(33_000, items, ['a', 'b']));
  });
});

const invalid = expect.objectContaining({ status: 422, response: expect.objectContaining({ code: 'SPLIT_INVALID' }) });
const asMap = (shares: { userId: string; amount: number }[]) => Object.fromEntries(shares.map((x) => [x.userId, x.amount]));

describe('splitItemized (chia theo từng món)', () => {
  const HTMQ = ['H', 'T', 'M', 'Q'];

  it('V1 (ảnh 18): hóa đơn Bách Hóa Xanh 245.000đ chia theo món, tổng món khớp tổng hóa đơn', () => {
    const shares = splitItemized(
      245_000,
      [
        { lineTotal: 32_000, userIds: HTMQ },
        { lineTotal: 15_000, userIds: HTMQ },
        { lineTotal: 108_000, userIds: ['H', 'Q'] },
        { lineTotal: 64_000, userIds: ['M'] },
        { lineTotal: 26_000, userIds: HTMQ },
      ],
      HTMQ,
    );
    expect(asMap(shares)).toEqual({ H: 72_250, T: 18_250, M: 82_250, Q: 72_250 });
    expect(shares.map((x) => x.userId)).toEqual(HTMQ);
    expect(sum(shares)).toBe(245_000);
  });

  it('V2 (giảm giá): tổng hóa đơn nhỏ hơn tổng món thì phần chênh trừ theo tỷ lệ tiền món của từng người', () => {
    const shares = splitItemized(
      100_000,
      [
        { lineTotal: 60_000, userIds: ['a', 'b', 'c'] },
        { lineTotal: 50_000, userIds: ['a'] },
      ],
      ['a', 'b', 'c'],
    );
    // a gánh 70.000/110.000 của phần giảm 10.000, b và c mỗi người 20.000/110.000; dư 1đ trừ thêm cho a (đầu danh sách).
    expect(asMap(shares)).toEqual({ a: 63_636, b: 18_182, c: 18_182 });
    expect(sum(shares)).toBe(100_000);
  });

  it('V3 (phí): tổng hóa đơn lớn hơn tổng món thì phần chênh cộng theo tỷ lệ', () => {
    const shares = splitItemized(33_000, [{ lineTotal: 30_000, userIds: ['a', 'b'] }], ['a', 'b', 'c']);
    expect(asMap(shares)).toEqual({ a: 16_500, b: 16_500 });
  });

  it('V4 (dư 1đ): phần dư cộng 1đ cho người đứng đầu danh sách ưu tiên', () => {
    const shares = splitItemized(10_001, [{ lineTotal: 10_000, userIds: ['a', 'b'] }], ['a', 'b', 'c']);
    expect(asMap(shares)).toEqual({ a: 5_001, b: 5_000 });
  });

  it('V5 (số lớn): tích diff × tiền món vượt 2^53 vẫn chia đúng tới từng đồng nhờ BigInt', () => {
    // diff = 100.000.000, base(a) = 700.000.000 → tích 7×10^16 > Number.MAX_SAFE_INTEGER.
    expect(100_000_000 * 700_000_000).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    const shares = splitItemized(
      1_000_000_000,
      [
        { lineTotal: 500_000_000, userIds: ['a'] },
        { lineTotal: 400_000_000, userIds: ['a', 'b'] },
      ],
      ['a', 'b', 'c'],
    );
    expect(asMap(shares)).toEqual({ a: 777_777_778, b: 222_222_222 });
    expect(sum(shares)).toBe(1_000_000_000);
  });

  it('bất biến: Σ phần chia luôn bằng total và không phần nào âm (200 ca ngẫu nhiên có seed, tổng tới 1 tỷ)', () => {
    const rnd = rng(20261019);
    const pick = (n: number) => Math.floor(rnd() * n);
    for (let run = 0; run < 200; run++) {
      const people = Array.from({ length: 2 + pick(5) }, (_, i) => 'u' + i);
      const items = Array.from({ length: 1 + pick(8) }, () => {
        const k = 1 + pick(people.length);
        const userIds = people.filter(() => rnd() < k / people.length);
        return { lineTotal: 1 + pick(300_000_000), userIds: userIds.length ? userIds : [people[pick(people.length)]] };
      });
      const total = 1 + pick(1_000_000_000);
      const shares = splitItemized(total, items, people);
      expect(sum(shares), 'run ' + run).toBe(total);
      for (const x of shares) expect(x.amount, 'run ' + run + ' ' + x.userId).toBeGreaterThanOrEqual(0);
    }
  });

  it('món nhỏ hơn số người (2đ chia 3 người) không tạo phần 0đ trong kết quả', () => {
    const shares = splitItemized(2, [{ lineTotal: 2, userIds: ['a', 'b', 'c'] }], ['a', 'b', 'c']);
    expect(asMap(shares)).toEqual({ a: 1, b: 1 });
  });

  it('kết quả theo thứ tự ưu tiên; người ngoài danh sách ưu tiên vẫn nhận phần và đứng sau cùng', () => {
    const shares = splitItemized(10, [{ lineTotal: 10, userIds: ['x', 'b', 'a'] }], ['a', 'b']);
    expect(shares.map((x) => x.userId)).toEqual(['a', 'b', 'x']);
    expect(sum(shares)).toBe(10);
  });

  it('đầu vào sai: ném SPLIT_INVALID (422)', () => {
    const ok = [{ lineTotal: 100, userIds: ['a'] }];
    expect(() => splitItemized(100, [], ['a'])).toThrowError(invalid);
    expect(() => splitItemized(0, ok, ['a'])).toThrowError(invalid);
    expect(() => splitItemized(-1, ok, ['a'])).toThrowError(invalid);
    expect(() => splitItemized(1.5, ok, ['a'])).toThrowError(invalid);
    expect(() => splitItemized(100, [{ lineTotal: 0, userIds: ['a'] }], ['a'])).toThrowError(invalid);
    expect(() => splitItemized(100, [{ lineTotal: -5, userIds: ['a'] }], ['a'])).toThrowError(invalid);
    expect(() => splitItemized(100, [{ lineTotal: 10.5, userIds: ['a'] }], ['a'])).toThrowError(invalid);
    expect(() => splitItemized(100, [{ lineTotal: 100, userIds: [] }], ['a'])).toThrowError(invalid);
    expect(() => splitItemized(100, [{ lineTotal: 100, userIds: ['a', 'a'] }], ['a'])).toThrowError(invalid);
  });
});

import { describe, expect, it } from 'vitest';
import {
  computeNetBalances,
  minCashFlow,
  pairwiseDebts,
  type DebtExpense,
  type DebtSettlement,
  type Transfer,
} from './min-cash-flow.js';

/** LCG có seed: test ngẫu nhiên nhưng tái lập được. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const sumNet = (net: ReadonlyMap<string, number>) => [...net.values()].reduce((s, v) => s + v, 0);

/** Một khoản nợ trực tiếp `debtor` nợ `creditor`: creditor trả, chỉ debtor chịu. */
const debt = (creditor: string, debtor: string, amount: number): DebtExpense => ({
  payerId: creditor,
  totalAmount: amount,
  splits: [{ userId: debtor, allocatedAmount: amount }],
});

/** 6 quan hệ nợ chéo của ảnh thiết kế 09 (H = Hùng, T = Thiện, M = Mai, Q = Quân), tổng 640.000đ luân chuyển. */
const IMAGE_09: DebtExpense[] = [
  debt('M', 'H', 145_000),
  debt('M', 'Q', 40_000),
  debt('Q', 'H', 75_000),
  debt('M', 'T', 195_000),
  debt('H', 'T', 50_000),
  debt('Q', 'T', 135_000),
];

/** Áp dụng các giao dịch lên số dư: người chuyển được cộng, người nhận bị trừ. Hết nợ thì mọi số dư về 0. */
function applyTransfers(net: ReadonlyMap<string, number>, transfers: Transfer[]) {
  const out = new Map(net);
  for (const t of transfers) {
    out.set(t.from, (out.get(t.from) ?? 0) + t.amount);
    out.set(t.to, (out.get(t.to) ?? 0) - t.amount);
  }
  return out;
}

describe('computeNetBalances', () => {
  it('người trả cộng cả hóa đơn, mỗi người chịu trừ phần của mình', () => {
    // Mai trả 120.000đ chia đều 4 người: Mai +90.000, 3 người còn lại −30.000.
    const net = computeNetBalances([
      {
        payerId: 'mai',
        totalAmount: 120_000,
        splits: ['hung', 'thien', 'mai', 'quan'].map((userId) => ({ userId, allocatedAmount: 30_000 })),
      },
    ]);
    expect(net.get('mai')).toBe(90_000);
    expect(net.get('hung')).toBe(-30_000);
    expect(net.get('thien')).toBe(-30_000);
    expect(net.get('quan')).toBe(-30_000);
    expect(sumNet(net)).toBe(0);
  });

  it('bộ dữ liệu ảnh 09: Mai +380k, Quân +170k, Hùng −170k, Thiện −380k', () => {
    const net = computeNetBalances(IMAGE_09);
    expect(Object.fromEntries(net)).toEqual({ M: 380_000, Q: 170_000, H: -170_000, T: -380_000 });
  });

  it('settlement CONFIRMED đổi số dư đúng chiều (người chuyển +, người nhận −)', () => {
    const settlements: DebtSettlement[] = [{ fromUserId: 'T', toUserId: 'M', amount: 100_000, status: 'CONFIRMED' }];
    const net = computeNetBalances(IMAGE_09, settlements);
    expect(net.get('T')).toBe(-280_000);
    expect(net.get('M')).toBe(280_000);
    expect(sumNet(net)).toBe(0);
  });

  it('settlement PENDING và CANCELLED không ảnh hưởng số dư', () => {
    const settlements: DebtSettlement[] = [
      { fromUserId: 'T', toUserId: 'M', amount: 380_000, status: 'PENDING' },
      { fromUserId: 'H', toUserId: 'Q', amount: 170_000, status: 'CANCELLED' },
    ];
    expect(computeNetBalances(IMAGE_09, settlements)).toEqual(computeNetBalances(IMAGE_09));
  });

  it('thành viên không có giao dịch vẫn xuất hiện với số dư 0 khi truyền memberIds', () => {
    const net = computeNetBalances([debt('a', 'b', 10_000)], [], ['a', 'b', 'c']);
    expect(net.get('c')).toBe(0);
  });

  it('không có dữ liệu thì Map rỗng', () => {
    expect(computeNetBalances([]).size).toBe(0);
  });
});

describe('minCashFlow', () => {
  it('ảnh 09: 6 quan hệ nợ chéo rút gọn còn 2 giao dịch (Thiện → Mai 380k, Hùng → Quân 170k)', () => {
    expect(IMAGE_09).toHaveLength(6);
    const plan = minCashFlow(computeNetBalances(IMAGE_09));
    expect(plan).toHaveLength(2);
    expect(plan).toContainEqual({ from: 'T', to: 'M', amount: 380_000 });
    expect(plan).toContainEqual({ from: 'H', to: 'Q', amount: 170_000 });
    expect(plan.reduce((s, t) => s + t.amount, 0)).toBe(550_000);
  });

  it('DoD: 4 người nợ chéo phức tạp (≥ 6 quan hệ) rút gọn thành tối đa 3 giao dịch', () => {
    // Khoản nợ chéo hai chiều giữa nhiều cặp: 8 quan hệ trên 4 người.
    const expenses = [
      debt('A', 'B', 100_000),
      debt('B', 'A', 30_000),
      debt('B', 'C', 70_000),
      debt('C', 'D', 120_000),
      debt('D', 'A', 40_000),
      debt('A', 'C', 55_000),
      debt('D', 'B', 25_000),
      debt('C', 'A', 15_000),
    ];
    expect(expenses.length).toBeGreaterThanOrEqual(6);
    const net = computeNetBalances(expenses);
    const plan = minCashFlow(net);
    expect(plan.length).toBeLessThanOrEqual(3);
    expect([...applyTransfers(net, plan).values()].every((v) => v === 0)).toBe(true);
  });

  it('ca xấu của greedy vẫn không vượt N−1 (cần đúng 3 giao dịch cho 4 người)', () => {
    // A −100, B −100, C +150, D +50.
    const net = new Map([
      ['A', -100],
      ['B', -100],
      ['C', 150],
      ['D', 50],
    ]);
    const plan = minCashFlow(net);
    expect(plan).toHaveLength(3);
    expect(plan.length).toBeLessThanOrEqual(net.size - 1);
  });

  it('ghép con nợ lớn nhất với chủ nợ lớn nhất trước (kế hoạch chính xác, hòa thì theo userId)', () => {
    // A −50, B −30 | C +60, D +20: A→C 50, rồi B→D 20 (D lớn hơn phần còn lại của C), cuối cùng B→C 10.
    const net = new Map([
      ['A', -50],
      ['B', -30],
      ['C', 60],
      ['D', 20],
    ]);
    expect(minCashFlow(net)).toEqual([
      { from: 'A', to: 'C', amount: 50 },
      { from: 'B', to: 'D', amount: 20 },
      { from: 'B', to: 'C', amount: 10 },
    ]);
  });

  it('một con nợ một chủ nợ thì đúng 1 giao dịch', () => {
    expect(minCashFlow(new Map([['a', -50_000], ['b', 50_000]]))).toEqual([{ from: 'a', to: 'b', amount: 50_000 }]);
  });

  it('mọi số dư bằng 0 thì không có giao dịch', () => {
    expect(minCashFlow(new Map([['a', 0], ['b', 0]]))).toEqual([]);
    expect(minCashFlow(new Map())).toEqual([]);
  });

  it('kết quả xác định: cùng đầu vào, cùng đầu ra, bất kể thứ tự Map', () => {
    const a = minCashFlow(new Map([['x', -100], ['y', -100], ['z', 100], ['w', 100]]));
    const b = minCashFlow(new Map([['w', 100], ['z', 100], ['y', -100], ['x', -100]]));
    expect(a).toEqual(b);
  });

  it('ném lỗi khi tổng số dư khác 0 (dữ liệu hỏng), không âm thầm làm mất tiền', () => {
    expect(() => minCashFlow(new Map([['a', -100], ['b', 90]]))).toThrowError(/tổng/i);
  });

  it('ném lỗi khi số dư không phải số nguyên', () => {
    expect(() => minCashFlow(new Map([['a', -0.5], ['b', 0.5]]))).toThrowError();
  });

  it('500 nhà ngẫu nhiên (2–8 người): tổng chuyển đi = tổng nhận về, ≤ N−1 giao dịch, mọi số dư về 0', () => {
    const rand = rng(207);
    for (let round = 0; round < 500; round++) {
      const n = 2 + Math.floor(rand() * 7);
      const people = Array.from({ length: n }, (_, i) => `u${i}`);
      const expenses: DebtExpense[] = [];
      for (let k = 0, count = 1 + Math.floor(rand() * 15); k < count; k++) {
        const payerId = people[Math.floor(rand() * n)];
        const total = 1 + Math.floor(rand() * 2_000_000);
        // Chia ngẫu nhiên cho một tập con người, tổng luôn đúng bằng total.
        const chosen = people.filter(() => rand() < 0.6);
        const group = chosen.length ? chosen : [payerId];
        const base = Math.floor(total / group.length);
        const extra = total - base * group.length;
        expenses.push({
          payerId,
          totalAmount: total,
          splits: group.map((userId, i) => ({ userId, allocatedAmount: base + (i < extra ? 1 : 0) })),
        });
      }
      const net = computeNetBalances(expenses, [], people);
      // Bất biến: tổng số dư luôn bằng 0.
      expect(sumNet(net), `vòng ${round}`).toBe(0);

      const plan = minCashFlow(net);
      expect(plan.length).toBeLessThanOrEqual(n - 1);
      expect(plan.every((t) => Number.isInteger(t.amount) && t.amount > 0 && t.from !== t.to)).toBe(true);

      const owed = [...net.values()].filter((v) => v > 0).reduce((s, v) => s + v, 0);
      const moved = plan.reduce((s, t) => s + t.amount, 0);
      expect(moved).toBe(owed);
      expect([...applyTransfers(net, plan).values()].every((v) => v === 0)).toBe(true);
    }
  });
});

describe('pairwiseDebts (dữ liệu sơ đồ "Trước")', () => {
  const key = (t: Transfer) => `${t.from}>${t.to}:${t.amount}`;

  it('ảnh 09: tái tạo đúng 6 cạnh nợ chéo', () => {
    const raw = pairwiseDebts(IMAGE_09);
    expect(raw.map(key).sort()).toEqual(
      ['H>M:145000', 'Q>M:40000', 'H>Q:75000', 'T>M:195000', 'T>H:50000', 'T>Q:135000'].sort(),
    );
    expect(raw.reduce((s, t) => s + t.amount, 0)).toBe(640_000);
  });

  it('cấn trừ hai chiều giữa một cặp thành một cạnh', () => {
    const raw = pairwiseDebts([debt('a', 'b', 100_000), debt('b', 'a', 30_000)]);
    expect(raw).toEqual([{ from: 'b', to: 'a', amount: 70_000 }]);
  });

  it('cặp hòa nhau thì không có cạnh', () => {
    expect(pairwiseDebts([debt('a', 'b', 50_000), debt('b', 'a', 50_000)])).toEqual([]);
  });

  it('phần tự chịu của người trả không tạo cạnh nợ', () => {
    const raw = pairwiseDebts([
      {
        payerId: 'a',
        totalAmount: 90_000,
        splits: ['a', 'b', 'c'].map((userId) => ({ userId, allocatedAmount: 30_000 })),
      },
    ]);
    expect(raw.map(key).sort()).toEqual(['b>a:30000', 'c>a:30000']);
  });

  it('settlement CONFIRMED trừ vào cạnh của đúng cặp; PENDING thì không', () => {
    const confirmed: DebtSettlement[] = [{ fromUserId: 'T', toUserId: 'M', amount: 95_000, status: 'CONFIRMED' }];
    const pending: DebtSettlement[] = [{ fromUserId: 'T', toUserId: 'M', amount: 95_000, status: 'PENDING' }];
    expect(pairwiseDebts(IMAGE_09, confirmed).find((t) => t.from === 'T' && t.to === 'M')?.amount).toBe(100_000);
    expect(pairwiseDebts(IMAGE_09, pending).find((t) => t.from === 'T' && t.to === 'M')?.amount).toBe(195_000);
  });

  it('trả vượt nợ cặp thì cạnh đảo chiều (không mất tiền)', () => {
    const raw = pairwiseDebts([debt('a', 'b', 10_000)], [{ fromUserId: 'b', toUserId: 'a', amount: 25_000, status: 'CONFIRMED' }]);
    expect(raw).toEqual([{ from: 'a', to: 'b', amount: 15_000 }]);
  });

  it('nhất quán với số dư ròng: Σ cạnh raw theo từng người = computeNetBalances (200 nhà ngẫu nhiên)', () => {
    const rand = rng(99);
    for (let round = 0; round < 200; round++) {
      const people = Array.from({ length: 2 + Math.floor(rand() * 6) }, (_, i) => `u${i}`);
      const expenses: DebtExpense[] = [];
      const settlements: DebtSettlement[] = [];
      for (let k = 0; k < 1 + Math.floor(rand() * 10); k++) {
        const payerId = people[Math.floor(rand() * people.length)];
        const total = 1 + Math.floor(rand() * 900_000);
        const group = people.filter(() => rand() < 0.6);
        const members = group.length ? group : [payerId];
        const base = Math.floor(total / members.length);
        const extra = total - base * members.length;
        expenses.push({
          payerId,
          totalAmount: total,
          splits: members.map((userId, i) => ({ userId, allocatedAmount: base + (i < extra ? 1 : 0) })),
        });
      }
      for (let k = 0; k < Math.floor(rand() * 4); k++) {
        const from = people[Math.floor(rand() * people.length)];
        const to = people[(people.indexOf(from) + 1 + Math.floor(rand() * (people.length - 1))) % people.length];
        settlements.push({ fromUserId: from, toUserId: to, amount: 1 + Math.floor(rand() * 100_000), status: 'CONFIRMED' });
      }
      const net = computeNetBalances(expenses, settlements, people);
      const fromRaw = new Map<string, number>(people.map((p) => [p, 0]));
      for (const t of pairwiseDebts(expenses, settlements)) {
        fromRaw.set(t.from, (fromRaw.get(t.from) ?? 0) - t.amount);
        fromRaw.set(t.to, (fromRaw.get(t.to) ?? 0) + t.amount);
      }
      expect(Object.fromEntries(fromRaw), `vòng ${round}`).toEqual(Object.fromEntries(net));
    }
  });
});

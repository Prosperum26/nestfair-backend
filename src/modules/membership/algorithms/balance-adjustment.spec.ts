import { computeNetBalances } from '../../expenses/algorithms/min-cash-flow.js';
import { planAdjustment } from './balance-adjustment.js';

/** Áp các dòng điều chỉnh như settlement đã xác nhận rồi trả số dư mới. */
function after(net: Record<string, number>, lines: { fromUserId: string; toUserId: string; amount: number }[]) {
  const result = new Map(Object.entries(net));
  const adjusted = computeNetBalances([], lines.map((l) => ({ ...l, status: 'CONFIRMED' as const })));
  for (const [id, delta] of adjusted) result.set(id, (result.get(id) ?? 0) + delta);
  return Object.fromEntries(result);
}
const total = (net: Record<string, number>) => Object.values(net).reduce((s, v) => s + v, 0);
const ORDER = ['hung', 'thien', 'mai', 'quan'];

describe('planAdjustment', () => {
  it('số dư bằng 0 thì không có dòng nào', () => {
    expect(planAdjustment(new Map([['quan', 0], ['hung', 0]]), 'quan', { mode: 'WRITE_OFF', order: ORDER })).toEqual([]);
  });

  it('TRANSFER khi người rời đang nợ: người nhận gánh đúng khoản nợ', () => {
    const net = { hung: 170_000, thien: -380_000, mai: 380_000, quan: -170_000 };
    const lines = planAdjustment(new Map(Object.entries(net)), 'quan', { mode: 'TRANSFER', toUserId: 'thien', order: ORDER });
    expect(lines).toEqual([{ fromUserId: 'quan', toUserId: 'thien', amount: 170_000 }]);
    expect(after(net, lines)).toEqual({ hung: 170_000, thien: -550_000, mai: 380_000, quan: 0 });
  });

  it('TRANSFER khi người rời đang được nhận: người nhận hưởng phần được nhận', () => {
    const net = { hung: 170_000, thien: -380_000, mai: 380_000, quan: -170_000 };
    const lines = planAdjustment(new Map(Object.entries(net)), 'mai', { mode: 'TRANSFER', toUserId: 'hung', order: ORDER });
    expect(lines).toEqual([{ fromUserId: 'hung', toUserId: 'mai', amount: 380_000 }]);
    expect(after(net, lines)).toEqual({ hung: 550_000, thien: -380_000, mai: 0, quan: -170_000 });
  });

  it('WRITE_OFF người nợ: các chủ nợ chịu theo tỷ lệ số được nhận, tổng vẫn bằng 0', () => {
    const net = { hung: 100_000, thien: 300_000, mai: -100_000, quan: -300_000 };
    const lines = planAdjustment(new Map(Object.entries(net)), 'quan', { mode: 'WRITE_OFF', order: ORDER });
    expect(lines).toEqual([
      { fromUserId: 'quan', toUserId: 'hung', amount: 75_000 },
      { fromUserId: 'quan', toUserId: 'thien', amount: 225_000 },
    ]);
    const next = after(net, lines);
    expect(next).toEqual({ hung: 25_000, thien: 75_000, mai: -100_000, quan: 0 });
    expect(total(next)).toBe(0);
  });

  it('WRITE_OFF người được nhận: các con nợ được bớt theo tỷ lệ', () => {
    const net = { hung: 300_000, thien: -200_000, mai: -100_000 };
    const lines = planAdjustment(new Map(Object.entries(net)), 'hung', { mode: 'WRITE_OFF', order: ORDER });
    expect(lines).toEqual([
      { fromUserId: 'thien', toUserId: 'hung', amount: 200_000 },
      { fromUserId: 'mai', toUserId: 'hung', amount: 100_000 },
    ]);
    expect(after(net, lines)).toEqual({ hung: 0, thien: 0, mai: 0 });
  });

  it('WRITE_OFF chia lẻ: phần dư cộng 1đ lần lượt từ đầu danh sách (thứ tự vào nhà)', () => {
    // 100đ chia cho 3 chủ nợ ngang nhau: 34 / 33 / 33.
    const net = { hung: 100, thien: 100, mai: 100, quan: -300 + 200, x: -200 };
    const lines = planAdjustment(new Map(Object.entries(net)), 'quan', { mode: 'WRITE_OFF', order: ['x', 'hung', 'thien', 'mai', 'quan'] });
    expect(lines).toEqual([
      { fromUserId: 'quan', toUserId: 'hung', amount: 34 },
      { fromUserId: 'quan', toUserId: 'thien', amount: 33 },
      { fromUserId: 'quan', toUserId: 'mai', amount: 33 },
    ]);
    expect(total(after(net, lines))).toBe(0);
  });

  it('WRITE_OFF không ai bị đổi dấu: mỗi chủ nợ chịu không quá số được nhận của mình', () => {
    const net = { hung: 1, thien: 2, mai: 7, quan: -10 };
    const lines = planAdjustment(new Map(Object.entries(net)), 'quan', { mode: 'WRITE_OFF', order: ORDER });
    const next = after(net, lines);
    expect(next).toEqual({ hung: 0, thien: 0, mai: 0, quan: 0 });
    for (const l of lines) expect(l.amount).toBeGreaterThan(0);
  });

  it('WRITE_OFF ngẫu nhiên: tổng luôn 0, người rời về 0, không ai đổi dấu', () => {
    for (let run = 0; run < 200; run++) {
      const ids = ['a', 'b', 'c', 'd', 'e'];
      const values = ids.slice(0, 4).map(() => Math.floor(Math.random() * 2_000_001) - 1_000_000);
      const net: Record<string, number> = Object.fromEntries(ids.slice(0, 4).map((id, i) => [id, values[i]]));
      net.e = -values.reduce((s, v) => s + v, 0);
      const leaver = ids[run % 5];
      const lines = planAdjustment(new Map(Object.entries(net)), leaver, { mode: 'WRITE_OFF', order: ids });
      const next = after(net, lines);
      expect(total(next)).toBe(0);
      expect(next[leaver]).toBe(0);
      for (const id of ids) if (id !== leaver) expect(Math.sign(next[id]) * Math.sign(net[id])).not.toBe(-1);
    }
  });

  it('TRANSFER thiếu người nhận hoặc người nhận là chính người rời thì ném lỗi', () => {
    const net = new Map([['quan', -100], ['hung', 100]]);
    expect(() => planAdjustment(net, 'quan', { mode: 'TRANSFER', order: ORDER })).toThrow();
    expect(() => planAdjustment(net, 'quan', { mode: 'TRANSFER', toUserId: 'quan', order: ORDER })).toThrow();
  });
});

/** Phần của `Expense` mà thuật toán cần. Tiền là số nguyên VNĐ. */
export interface DebtExpense {
  payerId: string;
  totalAmount: number;
  splits: readonly { userId: string; allocatedAmount: number }[];
}

/** Phần của `Settlement` mà thuật toán cần. Chỉ `CONFIRMED` mới ảnh hưởng số dư. */
export interface DebtSettlement {
  fromUserId: string;
  toUserId: string;
  amount: number;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
}

/** `from` chuyển `amount` cho `to`. */
export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/**
 * Số dư ròng của từng người: `Σ đã trả − Σ phần chịu`, cộng chỉnh theo settlement đã xác nhận
 * (người chuyển +, người nhận −). Dương = được nhận, âm = cần trả. Tổng luôn bằng 0.
 * `memberIds` để người chưa có giao dịch vẫn xuất hiện với số dư 0.
 */
export function computeNetBalances(
  expenses: readonly DebtExpense[],
  settlements: readonly DebtSettlement[] = [],
  memberIds: Iterable<string> = [],
): Map<string, number> {
  const net = new Map<string, number>();
  const add = (userId: string, delta: number) => net.set(userId, (net.get(userId) ?? 0) + delta);

  for (const id of memberIds) add(id, 0);
  for (const e of expenses) {
    add(e.payerId, e.totalAmount);
    for (const s of e.splits) add(s.userId, -s.allocatedAmount);
  }
  for (const s of settlements) {
    if (s.status !== 'CONFIRMED') continue;
    add(s.fromUserId, s.amount);
    add(s.toUserId, -s.amount);
  }
  return net;
}

/** Tìm người có |số dư| lớn nhất; hòa thì chọn userId nhỏ hơn để kết quả xác định. */
function pickLargest(entries: Map<string, number>): string {
  let best: string | undefined;
  for (const [id, amount] of entries) {
    if (best === undefined || amount > entries.get(best)! || (amount === entries.get(best)! && id < best)) best = id;
  }
  return best!;
}

/**
 * Min Cash Flow (greedy max-min): lặp ghép con nợ lớn nhất với chủ nợ lớn nhất, chuyển
 * `min(nợ, được nhận)`. Mỗi bước xóa ít nhất một người khỏi cuộc chơi và bước cuối xóa hai người,
 * nên với N người có số dư khác 0 chỉ cần tối đa N−1 giao dịch. Tiền là số nguyên nên không có làm tròn.
 *
 * Ném lỗi nếu số dư không nguyên hoặc tổng khác 0: đó là dữ liệu hỏng, không được âm thầm làm mất tiền.
 */
export function minCashFlow(net: ReadonlyMap<string, number>): Transfer[] {
  let total = 0;
  for (const [id, balance] of net) {
    if (!Number.isSafeInteger(balance)) throw new Error(`Số dư của ${id} không phải số nguyên VNĐ: ${balance}`);
    total += balance;
  }
  if (total !== 0) throw new Error(`Tổng số dư phải bằng 0 nhưng đang là ${total}`);

  const debtors = new Map<string, number>();
  const creditors = new Map<string, number>();
  for (const [id, balance] of net) {
    if (balance < 0) debtors.set(id, -balance);
    else if (balance > 0) creditors.set(id, balance);
  }

  const plan: Transfer[] = [];
  while (debtors.size > 0 && creditors.size > 0) {
    const from = pickLargest(debtors);
    const to = pickLargest(creditors);
    const amount = Math.min(debtors.get(from)!, creditors.get(to)!);
    plan.push({ from, to, amount });

    const debtLeft = debtors.get(from)! - amount;
    const creditLeft = creditors.get(to)! - amount;
    if (debtLeft === 0) debtors.delete(from);
    else debtors.set(from, debtLeft);
    if (creditLeft === 0) creditors.delete(to);
    else creditors.set(to, creditLeft);
  }
  return plan;
}

/**
 * Nợ trực tiếp theo từng cặp (dữ liệu cho sơ đồ "Trước" khi rút gọn): với mỗi khoản chi, mỗi người
 * chịu phần khác người trả nợ người trả; nợ hai chiều của một cặp được cấn trừ thành một cạnh;
 * settlement đã xác nhận trừ vào cạnh của đúng cặp (trả vượt thì cạnh đảo chiều). Cạnh sắp theo (from, to).
 * Tổng theo từng người của các cạnh này bằng `computeNetBalances`.
 */
export function pairwiseDebts(
  expenses: readonly DebtExpense[],
  settlements: readonly DebtSettlement[] = [],
): Transfer[] {
  // Khóa theo cặp đã sắp thứ tự (a < b); giá trị dương = a nợ b, âm = b nợ a.
  const pairs = new Map<string, number>();
  const owe = (debtor: string, creditor: string, amount: number) => {
    if (debtor === creditor || amount === 0) return;
    const [a, b] = debtor < creditor ? [debtor, creditor] : [creditor, debtor];
    const sign = debtor === a ? 1 : -1;
    const key = JSON.stringify([a, b]);
    pairs.set(key, (pairs.get(key) ?? 0) + sign * amount);
  };

  for (const e of expenses) for (const s of e.splits) owe(s.userId, e.payerId, s.allocatedAmount);
  for (const s of settlements) if (s.status === 'CONFIRMED') owe(s.toUserId, s.fromUserId, s.amount);

  const edges: Transfer[] = [];
  for (const [key, value] of pairs) {
    if (value === 0) continue;
    const [a, b] = JSON.parse(key) as [string, string];
    edges.push(value > 0 ? { from: a, to: b, amount: value } : { from: b, to: a, amount: -value });
  }
  return edges.sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : x.to < y.to ? -1 : x.to > y.to ? 1 : 0));
}

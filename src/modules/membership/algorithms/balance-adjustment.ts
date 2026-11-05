/** Cách xử lý số dư của người bị xóa khỏi nhà. */
export type AdjustmentMode = 'WRITE_OFF' | 'TRANSFER';

/**
 * Một dòng điều chỉnh, có tác dụng y như một settlement đã xác nhận: `fromUserId` +amount, `toUserId` −amount.
 * Nhờ vậy số dư ròng, nợ chéo và Min Cash Flow tính đúng mà không phải sửa thuật toán.
 */
export interface AdjustmentLine {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

export interface AdjustmentOptions {
  mode: AdjustmentMode;
  /** TRANSFER: người nhận phần số dư. */
  toUserId?: string;
  /** Thứ tự vào nhà: quyết định ai nhận 1đ dư khi chia lẻ (AGENTS.md mục 4, từ đầu danh sách). */
  order: readonly string[];
}

/**
 * Đưa số dư của `leaverId` về 0, tổng số dư cả nhà vẫn bằng 0.
 * - TRANSFER: người nhận gánh đúng số dư (nợ thì gánh nợ, được nhận thì hưởng).
 * - WRITE_OFF: xóa khoản đó; phần chênh trải lên những người ở phía ngược lại (người rời nợ thì
 *   các chủ nợ chịu, người rời được nhận thì các con nợ được bớt) theo tỷ lệ |số dư| của họ,
 *   nên không ai bị đổi dấu.
 */
export function planAdjustment(
  net: ReadonlyMap<string, number>,
  leaverId: string,
  options: AdjustmentOptions,
): AdjustmentLine[] {
  const n = net.get(leaverId) ?? 0;
  if (n === 0) return [];
  const owes = n < 0;
  const amount = Math.abs(n);

  if (options.mode === 'TRANSFER') {
    const to = options.toUserId;
    if (!to || to === leaverId) throw new Error('TRANSFER cần người nhận khác người rời nhà');
    return owes ? [{ fromUserId: leaverId, toUserId: to, amount }] : [{ fromUserId: to, toUserId: leaverId, amount }];
  }

  // Phía ngược lại theo thứ tự vào nhà; người có số dư nhưng không có trong `order` xếp cuối (theo id).
  const rank = (id: string) => {
    const i = options.order.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const opposite = [...net.entries()]
    .filter(([id, v]) => id !== leaverId && (owes ? v > 0 : v < 0))
    .map(([id, v]) => ({ id, weight: Math.abs(v) }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  const total = opposite.reduce((s, o) => s + o.weight, 0);
  if (total < amount) throw new Error('Số dư hỏng: phía ngược lại không đủ để xóa khoản này');

  const shares = opposite.map((o) => Math.floor((amount * o.weight) / total));
  let remainder = amount - shares.reduce((s, v) => s + v, 0);
  for (let i = 0; remainder > 0; i++, remainder--) shares[i] += 1;

  return opposite
    .map((o, i) => ({ id: o.id, share: shares[i] }))
    .filter((s) => s.share > 0)
    .map((s) =>
      owes
        ? { fromUserId: leaverId, toUserId: s.id, amount: s.share }
        : { fromUserId: s.id, toUserId: leaverId, amount: s.share },
    );
}

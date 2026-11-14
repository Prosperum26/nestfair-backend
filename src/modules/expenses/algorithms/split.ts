import { HttpStatus } from '@nestjs/common';
import { coded } from '../../../common/coded-exception.js';

/** Một phần chia: `amount` là số nguyên VNĐ, không âm. */
export interface SplitShare {
  userId: string;
  amount: number;
}

/**
 * Đầu vào chia tiền theo từng `SplitType`. `ITEMIZED` (theo món của OCR): xem `splitItemized`.
 */
export type SplitInput =
  | { type: 'EQUAL'; total: number; userIds: readonly string[] }
  | { type: 'CUSTOM'; total: number; userIds: readonly string[] }
  | { type: 'EXACT'; total: number; amounts: readonly SplitShare[] }
  | { type: 'ITEMIZED'; total: number; items: readonly ItemizedItem[]; order: readonly string[] };

const invalid = (message: string) => coded(HttpStatus.UNPROCESSABLE_ENTITY, 'SPLIT_INVALID', message);

function assertTotal(total: number) {
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw invalid('Tổng tiền phải là số nguyên VNĐ lớn hơn 0');
  }
}

function assertUsers(userIds: readonly string[]) {
  if (userIds.length === 0) throw invalid('Cần ít nhất một người chịu phần chia');
  if (new Set(userIds).size !== userIds.length) throw invalid('Danh sách người chịu phần chia bị trùng');
}

/**
 * Chia đều `total` cho `userIds` (giữ nguyên thứ tự). Phần dư cộng lần lượt 1đ cho từng người
 * từ đầu danh sách, nên tổng luôn đúng bằng `total` và hai phần bất kỳ lệch nhau tối đa 1đ.
 */
export function splitEqual(total: number, userIds: readonly string[]): SplitShare[] {
  assertTotal(total);
  assertUsers(userIds);
  const base = Math.floor(total / userIds.length);
  const remainder = total - base * userIds.length;
  return userIds.map((userId, i) => ({ userId, amount: base + (i < remainder ? 1 : 0) }));
}

/** Chọn người hưởng: chia đều trong nhóm được chọn, người không chọn không có phần. */
export function splitCustom(total: number, userIds: readonly string[]): SplitShare[] {
  return splitEqual(total, userIds);
}

/** Số tiền cố định từng người. Mỗi phần là số nguyên ≥ 0 và tổng phải khớp `total`. */
export function splitExact(total: number, amounts: readonly SplitShare[]): SplitShare[] {
  assertTotal(total);
  assertUsers(amounts.map((a) => a.userId));
  for (const { amount } of amounts) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw invalid('Phần chia phải là số nguyên VNĐ không âm');
  }
  const sum = amounts.reduce((s, a) => s + a.amount, 0);
  if (sum !== total) {
    throw coded(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'SPLIT_SUM_MISMATCH',
      `Tổng các phần chia (${sum}đ) không khớp tổng khoản chi (${total}đ)`,
    );
  }
  return amounts.map(({ userId, amount }) => ({ userId, amount }));
}

/** Một món trên hóa đơn: số tiền dòng (số nguyên VNĐ > 0) và những người cùng dùng món đó. */
export interface ItemizedItem {
  lineTotal: number;
  userIds: readonly string[];
}

/**
 * Chia theo từng món (OCR hóa đơn).
 *
 * 1. Mỗi món chia đều cho người dùng nó (phần dư 1đ cho người đứng đầu `order`).
 * 2. Phần chênh giữa tổng hóa đơn và tổng các món (giảm giá, phí, làm tròn) được phân bổ theo tỷ lệ
 *    tiền món của từng người, dùng BigInt vì tích `chênh × tiền món` có thể vượt 2^53.
 * 3. Phần dư khi phân bổ chia lần lượt 1đ từ đầu `order`, nên Σ kết quả luôn bằng `total`.
 *
 * `order` là thứ tự ưu tiên nhận 1đ dư (thứ tự vào nhà); người không có trong `order` đứng sau cùng
 * theo thứ tự xuất hiện. Kết quả sắp theo thứ tự đó và chỉ gồm người có phần món > 0.
 */
export function splitItemized(total: number, items: readonly ItemizedItem[], order: readonly string[]): SplitShare[] {
  assertTotal(total);
  if (items.length === 0) throw invalid('Cần ít nhất một món để chia theo món');
  for (const { lineTotal, userIds } of items) {
    if (!Number.isSafeInteger(lineTotal) || lineTotal <= 0) throw invalid('Tiền mỗi món phải là số nguyên VNĐ lớn hơn 0');
    assertUsers(userIds);
  }

  const firstSeen = new Map<string, number>();
  for (const { userIds } of items) for (const u of userIds) if (!firstSeen.has(u)) firstSeen.set(u, firstSeen.size);
  const priority = (u: string) => {
    const i = order.indexOf(u);
    return i === -1 ? order.length + (firstSeen.get(u) ?? 0) : i;
  };
  const ranked = [...firstSeen.keys()].sort((a, b) => priority(a) - priority(b));
  const position = new Map(ranked.map((u, i) => [u, i] as const));

  const base = new Map<string, number>();
  let itemsSum = 0;
  for (const { lineTotal, userIds } of items) {
    itemsSum += lineTotal;
    const sorted = [...userIds].sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
    for (const { userId, amount } of splitEqual(lineTotal, sorted)) base.set(userId, (base.get(userId) ?? 0) + amount);
  }

  const payers = ranked.filter((u) => (base.get(u) ?? 0) > 0);
  const diff = total - itemsSum;
  const magnitude = BigInt(Math.abs(diff));
  const sign = diff < 0 ? -1 : 1;

  const adjust = new Map(payers.map((u) => [u, Number((magnitude * BigInt(base.get(u) ?? 0)) / BigInt(itemsSum))] as const));
  let remainder = Math.abs(diff) - [...adjust.values()].reduce((s, a) => s + a, 0);

  const shares = payers.map((userId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { userId, amount: (base.get(userId) ?? 0) + sign * ((adjust.get(userId) ?? 0) + extra) };
  });

  // Bất biến: nếu vi phạm thì là lỗi của thuật toán, không phải của người dùng.
  if (shares.some((s) => s.amount < 0) || shares.reduce((s, x) => s + x.amount, 0) !== total) {
    throw new Error('splitItemized vi phạm bất biến: tổng các phần khác tổng hóa đơn hoặc có phần âm');
  }
  return shares;
}

/** Điểm vào chung: điều phối theo `type`. */
export function computeSplit(input: SplitInput): SplitShare[] {
  switch (input.type) {
    case 'EQUAL':
      return splitEqual(input.total, input.userIds);
    case 'CUSTOM':
      return splitCustom(input.total, input.userIds);
    case 'EXACT':
      return splitExact(input.total, input.amounts);
    case 'ITEMIZED':
      return splitItemized(input.total, input.items, input.order);
  }
}

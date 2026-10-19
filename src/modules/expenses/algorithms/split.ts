import { HttpStatus } from '@nestjs/common';
import { coded } from '../../../common/coded-exception.js';

/** Một phần chia: `amount` là số nguyên VNĐ, không âm. */
export interface SplitShare {
  userId: string;
  amount: number;
}

/**
 * Đầu vào chia tiền theo từng `SplitType`. `ITEMIZED` (theo món của OCR) đã có chỗ trong interface
 * nhưng chưa cài: xem `computeSplit`.
 */
export type SplitInput =
  | { type: 'EQUAL'; total: number; userIds: readonly string[] }
  | { type: 'CUSTOM'; total: number; userIds: readonly string[] }
  | { type: 'EXACT'; total: number; amounts: readonly SplitShare[] }
  | { type: 'ITEMIZED'; total: number };

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
      throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'SPLIT_TYPE_NOT_SUPPORTED', 'Chia theo từng món chưa được hỗ trợ');
  }
}

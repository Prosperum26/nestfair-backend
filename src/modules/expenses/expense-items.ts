import { HttpStatus } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { SplitType } from '../../generated/prisma/enums.js';

/** Một món của hóa đơn như lưu trong cột `Expense.items`. `userIds` rỗng nếu khoản không chia theo món. */
// `type` (không phải interface) để gán được cho Prisma.InputJsonValue.
export type ExpenseItemData = {
  name: string;
  lineTotal: number;
  userIds: string[];
};

interface ItemInput {
  name: string;
  lineTotal: number;
  userIds?: readonly string[];
}

/**
 * Danh sách món sẽ lưu cho một khoản chi. Chỉ khoản chia theo món (ITEMIZED) giữ `userIds`;
 * kiểu chia khác chỉ lưu tên và tiền để xem lại (D2, D11).
 */
export function itemsForStorage(items: readonly ItemInput[] | undefined, splitType: SplitType): ExpenseItemData[] {
  return (items ?? []).map((i) => ({
    name: i.name,
    lineTotal: i.lineTotal,
    userIds: splitType === 'ITEMIZED' ? [...(i.userIds ?? [])] : [],
  }));
}

/** JSON đọc từ DB thành danh sách món an toàn: không phải mảng thì [], phần tử hỏng bị bỏ. */
export function parseStoredItems(value: unknown): ExpenseItemData[] {
  if (!Array.isArray(value)) return [];
  const out: ExpenseItemData[] = [];
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string' || !Number.isInteger(r.lineTotal)) continue;
    const userIds = Array.isArray(r.userIds) ? (r.userIds as unknown[]).filter((u): u is string => typeof u === 'string') : [];
    out.push({ name: r.name, lineTotal: r.lineTotal as number, userIds });
  }
  return out;
}

/** Giữ tên và tiền, bỏ người dùng món (khi khoản đổi khỏi kiểu chia theo món). */
export function clearAssignees(items: readonly ExpenseItemData[]): ExpenseItemData[] {
  return items.map((i) => ({ name: i.name, lineTotal: i.lineTotal, userIds: [] }));
}

/** Khoản chia theo món cần ít nhất một món và mỗi món có ít nhất một người dùng. */
export function assertItemizedItems(items: readonly { userIds?: readonly string[] }[]): void {
  if (items.length === 0) throw coded(HttpStatus.BAD_REQUEST, 'ITEMS_INVALID', 'Nhập ít nhất một món.');
  if (items.some((i) => !i.userIds?.length)) {
    throw coded(HttpStatus.BAD_REQUEST, 'ITEMS_INVALID', 'Mỗi món cần ít nhất một người dùng.');
  }
}

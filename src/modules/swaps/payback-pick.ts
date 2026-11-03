import type { AssignmentSource, AssignmentStatus } from '../../generated/prisma/enums.js';

const HOUR = 3_600_000;
/** Người làm bù cần ít nhất bấy nhiêu giờ sau khi hết hạn chọn (spec 5.4). */
export const PICK_BUFFER_HOURS = 12;

/** Ca của người được làm bù (creditor), dạng thuần để kiểm không cần DB. */
export interface PaybackSlot {
  id: string;
  choreId: string;
  title: string;
  weight: number;
  /** "YYYY-MM-DD" giờ nhà. */
  occurrenceDate: string;
  /** Thứ Hai của tuần, "YYYY-MM-DD". */
  weekStart: string;
  dueAt: Date;
  status: AssignmentStatus;
  source: AssignmentSource;
}

/** Trạng thái của người nợ (debtor) và ràng buộc chung, đã tính sẵn từ DB. */
export interface DebtorState {
  /** Ngày debtor vắng. */
  absentDates: Set<string>;
  /** `${choreId}|${occurrenceDate}` các ca debtor đã có (R-SWAP-3). */
  sameDayKeys: Set<string>;
  /** Ca đang nằm trong yêu cầu PENDING. */
  lockedIds: Set<string>;
  /** Các tuần được phép chọn. */
  weekStarts: Set<string>;
}

export type PaybackReason =
  | 'SLOT_NOT_SWAPPABLE'
  | 'SLOT_LOCKED'
  | 'PAYBACK_SLOT_LOCKED'
  | 'COVER_CHAIN_FORBIDDEN'
  | 'WHEEL_NOT_EXCHANGEABLE'
  | 'PAYBACK_WRONG_WEEK'
  | 'PAYBACK_TOO_SOON'
  | 'TARGET_ABSENT'
  | 'DUPLICATE_CHORE_SAME_DAY';

/** Lý do đầu tiên khiến ca không dùng làm ca bù được, hoặc null nếu hợp lệ. */
export function paybackReason(slot: PaybackSlot, pickDeadlineAt: Date, state: DebtorState): PaybackReason | null {
  if (slot.status !== 'TODO') return 'SLOT_NOT_SWAPPABLE';
  if (state.lockedIds.has(slot.id)) return 'SLOT_LOCKED';
  if (slot.source === 'PAYBACK') return 'PAYBACK_SLOT_LOCKED';
  if (slot.source === 'COVER') return 'COVER_CHAIN_FORBIDDEN';
  if (slot.source === 'WHEEL') return 'WHEEL_NOT_EXCHANGEABLE';
  if (!state.weekStarts.has(slot.weekStart)) return 'PAYBACK_WRONG_WEEK';
  if (slot.dueAt.getTime() < pickDeadlineAt.getTime() + PICK_BUFFER_HOURS * HOUR) return 'PAYBACK_TOO_SOON';
  if (state.absentDates.has(slot.occurrenceDate)) return 'TARGET_ABSENT';
  if (state.sameDayKeys.has(`${slot.choreId}|${slot.occurrenceDate}`)) return 'DUPLICATE_CHORE_SAME_DAY';
  return null;
}

/** Các ca hợp lệ làm ca bù (kiểm lúc hiển thị và kiểm lại lúc gán). */
export function validPaybackSlots(slots: PaybackSlot[], pickDeadlineAt: Date, state: DebtorState): PaybackSlot[] {
  return slots.filter((s) => paybackReason(s, pickDeadlineAt, state) === null);
}

/**
 * Auto-pick: `|weight − debtWeight|` nhỏ nhất; hòa thì `dueAt` muộn hơn; hòa tiếp thì `id` nhỏ hơn.
 * Trả id ca, hoặc null khi không có ứng viên.
 */
export function pickAuto(candidates: PaybackSlot[], debtWeight: number): string | null {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    const da = Math.abs(a.weight - debtWeight);
    const db = Math.abs(b.weight - debtWeight);
    if (da !== db) return da - db;
    if (a.dueAt.getTime() !== b.dueAt.getTime()) return b.dueAt.getTime() - a.dueAt.getTime();
    return a.id < b.id ? -1 : 1;
  });
  return sorted[0].id;
}

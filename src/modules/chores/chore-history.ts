import type { Db } from './schedule-context.js';

/** Ca đã có người làm, nộp, bị từ chối hoặc quá hạn: lịch sử thật, không được xóa cùng việc. */
const ACTIVITY_STATUSES = ['DONE', 'PENDING_VERIFY', 'REJECTED', 'MISSED'] as const;

/**
 * Việc đã từng có hoạt động chưa? Điều kiện để cho "Xóa vĩnh viễn" (spec 2026-11-15, mục 1).
 * Có hoạt động khi: có ca ở trạng thái DONE / PENDING_VERIFY / REJECTED / MISSED, hoặc có nợ ca, yêu cầu đổi ca, hay kết quả
 * vòng quay trỏ tới một ca của việc. Ca CANCELLED / UNASSIGNED / TODO chưa ai làm thì không tính (xóa cùng việc).
 * Các bảng nợ ca và đổi ca chỉ lưu id ca (không có khóa ngoại), nên phải kiểm ở đây.
 */
export async function hasChoreHistory(db: Db, choreId: string): Promise<boolean> {
  const slots = await db.choreAssignment.findMany({ where: { choreId }, select: { id: true, status: true } });
  if (slots.some((s) => (ACTIVITY_STATUSES as readonly string[]).includes(s.status))) return true;
  if (slots.length === 0) return false;

  const ids = slots.map((s) => s.id);
  const [debts, swaps, wheels] = await Promise.all([
    db.choreDebt.count({ where: { OR: [{ coverAssignmentId: { in: ids } }, { paybackAssignmentId: { in: ids } }] } }),
    db.choreSwapRequest.count({ where: { OR: [{ fromAssignmentId: { in: ids } }, { toAssignmentId: { in: ids } }] } }),
    db.luckyWheelLog.count({ where: { assignmentId: { in: ids } } }),
  ]);
  return debts + swaps + wheels > 0;
}

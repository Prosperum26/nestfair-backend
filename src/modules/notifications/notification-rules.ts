import { type NotificationPrefs, resolveNotificationPrefs } from '../users/notification-prefs.js';

/** Loại thông báo cá nhân (khớp enum `NotificationType` trong schema). */
export type NotificationKind = 'EXPENSE_CREATED' | 'DEBT_PAID' | 'REMINDER_DUE';

/** Người nhận thông báo "có khoản chi mới": ai có phần phải trả (> 0đ), trừ người tạo khoản chi. */
export function expenseRecipients(
  splits: readonly { userId: string; allocatedAmount: number }[],
  createdById: string,
): { userId: string; share: number }[] {
  return splits
    .filter((s) => s.userId !== createdById && s.allocatedAmount > 0)
    .map((s) => ({ userId: s.userId, share: s.allocatedAmount }));
}

/** Công tắc trong Hồ sơ quyết định loại thông báo này; null = không có công tắc, luôn gửi. */
export function prefKeyFor(kind: NotificationKind): keyof NotificationPrefs | null {
  if (kind === 'EXPENSE_CREATED') return 'expenseCreated';
  if (kind === 'DEBT_PAID') return 'debtPaid';
  return null;
}

/** `rawPrefs` là cột JSON `User.notificationPrefs` (null = chưa chỉnh, bật hết). */
export function allowedByPrefs(kind: NotificationKind, rawPrefs: unknown): boolean {
  const key = prefKeyFor(kind);
  return key === null || resolveNotificationPrefs(rawPrefs)[key];
}

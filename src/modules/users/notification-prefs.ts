export const NOTIFICATION_KEYS = ['expenseCreated', 'choreDigest', 'debtPaid'] as const;

export type NotificationPrefs = Record<(typeof NOTIFICATION_KEYS)[number], boolean>;

/** Chưa chỉnh gì thì bật hết. */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  expenseCreated: true,
  choreDigest: true,
  debtPaid: true,
};

/** Đọc cột JSON `notificationPrefs`: chỉ nhận 3 khóa boolean, khóa thiếu hoặc sai kiểu lấy mặc định. */
export function resolveNotificationPrefs(raw: unknown): NotificationPrefs {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_NOTIFICATION_PREFS };
  for (const key of NOTIFICATION_KEYS) {
    if (typeof source[key] === 'boolean') out[key] = source[key];
  }
  return out;
}

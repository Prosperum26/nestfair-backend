import { DEFAULT_NOTIFICATION_PREFS, resolveNotificationPrefs } from './notification-prefs.js';

describe('resolveNotificationPrefs', () => {
  it('null (chưa từng chỉnh) thì bật hết', () => {
    expect(resolveNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(DEFAULT_NOTIFICATION_PREFS).toEqual({ expenseCreated: true, choreDigest: true, debtPaid: true });
  });

  it('giữ giá trị boolean đã lưu, key thiếu thì bật', () => {
    expect(resolveNotificationPrefs({ choreDigest: false })).toEqual({ expenseCreated: true, choreDigest: false, debtPaid: true });
  });

  it('bỏ qua key lạ và giá trị không phải boolean', () => {
    expect(resolveNotificationPrefs({ debtPaid: 'no', hack: false, expenseCreated: 0 })).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(resolveNotificationPrefs('x')).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(resolveNotificationPrefs([false])).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});

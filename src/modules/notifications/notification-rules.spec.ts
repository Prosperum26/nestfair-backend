import { describe, expect, it } from 'vitest';
import { allowedByPrefs, expenseRecipients, prefKeyFor } from './notification-rules.js';

describe('expenseRecipients', () => {
  it('báo cho người có phần trong khoản chi, trừ người tạo', () => {
    const splits = [
      { userId: 'hung', allocatedAmount: 210_000 },
      { userId: 'thien', allocatedAmount: 210_000 },
      { userId: 'mai', allocatedAmount: 210_000 },
    ];
    expect(expenseRecipients(splits, 'hung')).toEqual([
      { userId: 'thien', share: 210_000 },
      { userId: 'mai', share: 210_000 },
    ]);
  });

  it('phần 0đ thì không báo (người đó không phải trả gì)', () => {
    const splits = [
      { userId: 'thien', allocatedAmount: 0 },
      { userId: 'mai', allocatedAmount: 500_000 },
    ];
    expect(expenseRecipients(splits, 'hung')).toEqual([{ userId: 'mai', share: 500_000 }]);
  });

  it('khoản chi chỉ của người tạo thì không báo ai', () => {
    expect(expenseRecipients([{ userId: 'hung', allocatedAmount: 100_000 }], 'hung')).toEqual([]);
  });
});

describe('prefKeyFor', () => {
  it('khoản chi mới và trả nợ theo công tắc trong Hồ sơ; nhắc nhở luôn gửi', () => {
    expect(prefKeyFor('EXPENSE_CREATED')).toBe('expenseCreated');
    expect(prefKeyFor('DEBT_PAID')).toBe('debtPaid');
    expect(prefKeyFor('REMINDER_DUE')).toBeNull();
  });
});

describe('allowedByPrefs', () => {
  it('chưa chỉnh gì (null) thì nhận hết', () => {
    expect(allowedByPrefs('EXPENSE_CREATED', null)).toBe(true);
    expect(allowedByPrefs('DEBT_PAID', undefined)).toBe(true);
  });

  it('tắt công tắc nào thì không nhận loại đó, loại khác không ảnh hưởng', () => {
    const prefs = { expenseCreated: false, debtPaid: true, choreDigest: true };
    expect(allowedByPrefs('EXPENSE_CREATED', prefs)).toBe(false);
    expect(allowedByPrefs('DEBT_PAID', prefs)).toBe(true);
  });

  it('nhắc nhở không có công tắc: luôn nhận kể cả khi tắt hết', () => {
    expect(allowedByPrefs('REMINDER_DUE', { expenseCreated: false, debtPaid: false, choreDigest: false })).toBe(true);
  });
});

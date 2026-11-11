import { describe, expect, it } from 'vitest';
import { MONTH_PATTERN } from './dto/list-expenses.query.js';
import { monthKeyOf, monthRange } from './month.js';

describe('month (giờ Việt Nam, UTC+7)', () => {
  it('MONTH_PATTERN (query ?month=) nhận YYYY-MM hợp lệ, từ chối sai định dạng', () => {
    expect(MONTH_PATTERN.test('2026-10')).toBe(true);
    expect(MONTH_PATTERN.test('2026-01')).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-10', '2026/10', '2026-10-01', '']) {
      expect(MONTH_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('monthRange: [00:00 ngày 1 giờ VN, 00:00 ngày 1 tháng sau giờ VN)', () => {
    const { start, end } = monthRange('2026-10');
    expect(start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('monthRange qua năm mới', () => {
    const { start, end } = monthRange('2026-12');
    expect(start.toISOString()).toBe('2026-11-30T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('monthKeyOf dùng giờ VN: 23:30 UTC ngày 31.10 đã là tháng 11 ở VN', () => {
    expect(monthKeyOf(new Date('2026-10-31T16:59:59Z'))).toBe('2026-10');
    expect(monthKeyOf(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11');
  });

  it('monthRange ném lỗi với key sai', () => {
    expect(() => monthRange('2026-13')).toThrow();
  });
});

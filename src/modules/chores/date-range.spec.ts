import { describe, expect, it } from 'vitest';
import { assertDateRange } from './date-range.js';

const fail = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    const ex = e as { getStatus: () => number; getResponse: () => Record<string, unknown> };
    return { status: ex.getStatus(), body: ex.getResponse() };
  }
  throw new Error('không ném lỗi');
};

describe('assertDateRange', () => {
  it('chấp nhận khoảng hợp lệ, kể cả một ngày (hai đầu bằng nhau)', () => {
    expect(() => assertDateRange('2026-10-05', '2026-10-11')).not.toThrow();
    expect(() => assertDateRange('2026-10-05', '2026-10-05')).not.toThrow();
  });

  it('kết thúc trước bắt đầu → 400 INVALID_DATE_RANGE', () => {
    const r = fail(() => assertDateRange('2026-10-06', '2026-10-05'));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'INVALID_DATE_RANGE' });
  });

  it('ngày không tồn tại (30.02, tháng 13) → 400', () => {
    expect(fail(() => assertDateRange('2026-02-30', '2026-03-01')).status).toBe(400);
    expect(fail(() => assertDateRange('2026-13-01', '2026-13-02')).status).toBe(400);
  });

  it('ngày nhuận hợp lệ: 2028-02-29', () => {
    expect(() => assertDateRange('2028-02-29', '2028-03-01')).not.toThrow();
  });
});

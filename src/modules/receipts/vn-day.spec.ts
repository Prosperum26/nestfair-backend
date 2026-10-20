import { describe, expect, it } from 'vitest';
import { vnDayStart } from './vn-day.js';

describe('vnDayStart: 00:00 giờ Việt Nam (UTC+7) của ngày chứa thời điểm đã cho', () => {
  it('hai mốc sát nửa đêm giờ VN ra hai ngày khác nhau', () => {
    // 23:59:59 ngày 18.10 giờ VN → đầu ngày 18.10 giờ VN.
    expect(vnDayStart(new Date('2026-10-18T16:59:59Z')).toISOString()).toBe('2026-10-17T17:00:00.000Z');
    // 00:00:00 ngày 19.10 giờ VN → chính nó.
    expect(vnDayStart(new Date('2026-10-18T17:00:00Z')).toISOString()).toBe('2026-10-18T17:00:00.000Z');
  });

  it('giữa ngày và đầu ngày UTC (đã sang ngày mới ở VN)', () => {
    expect(vnDayStart(new Date('2026-10-19T05:00:00Z')).toISOString()).toBe('2026-10-18T17:00:00.000Z');
    expect(vnDayStart(new Date('2026-10-19T00:00:00Z')).toISOString()).toBe('2026-10-18T17:00:00.000Z');
  });

  it('qua ranh giới tháng và năm', () => {
    expect(vnDayStart(new Date('2026-12-31T20:00:00Z')).toISOString()).toBe('2026-12-31T17:00:00.000Z');
    expect(vnDayStart(new Date('2027-01-01T01:00:00Z')).toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});

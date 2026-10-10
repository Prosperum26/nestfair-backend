import { describe, expect, it } from 'vitest';
import { isValidWeekKey, shiftWeek, weekKeyOf, weekRange } from './week.js';

describe('weekKeyOf', () => {
  it('Chủ Nhật 23:59:59 giờ VN vẫn thuộc tuần đó', () => {
    expect(weekKeyOf(new Date('2026-10-11T16:59:59Z'))).toBe('2026-W41');
  });

  it('Thứ Hai 00:00 giờ VN sang tuần mới', () => {
    expect(weekKeyOf(new Date('2026-10-11T17:00:00Z'))).toBe('2026-W42');
  });

  it('xử lý tuần 53 và qua năm', () => {
    expect(weekKeyOf(new Date('2026-12-28T05:00:00Z'))).toBe('2026-W53');
    expect(weekKeyOf(new Date('2027-01-04T05:00:00Z'))).toBe('2027-W01');
    expect(weekKeyOf(new Date('2027-01-03T05:00:00Z'))).toBe('2026-W53');
  });
});

describe('weekRange', () => {
  it('từ Thứ Hai 00:00 đến Chủ Nhật 23:59:59.999 giờ VN', () => {
    const { start, dueAt } = weekRange('2026-W41');
    expect(start.toISOString()).toBe('2026-10-04T17:00:00.000Z');
    expect(dueAt.toISOString()).toBe('2026-10-11T16:59:59.999Z');
  });
});

describe('shiftWeek', () => {
  it('cộng trừ tuần qua ranh giới năm', () => {
    expect(shiftWeek('2026-W52', 2)).toBe('2027-W01');
    expect(shiftWeek('2027-W01', -1)).toBe('2026-W53');
    expect(shiftWeek('2026-W41', 1)).toBe('2026-W42');
  });
});

describe('isValidWeekKey', () => {
  it('chấp nhận tuần hợp lệ, từ chối sai định dạng hoặc tuần không tồn tại', () => {
    expect(isValidWeekKey('2026-W41')).toBe(true);
    expect(isValidWeekKey('2026-W53')).toBe(true);
    expect(isValidWeekKey('2027-W53')).toBe(false);
    expect(isValidWeekKey('2026-W54')).toBe(false);
    expect(isValidWeekKey('2026-W00')).toBe(false);
    expect(isValidWeekKey('abc')).toBe(false);
  });
});

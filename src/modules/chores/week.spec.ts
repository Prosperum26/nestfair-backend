import { describe, expect, it } from 'vitest';
import {
  addDays,
  currentWeekStart,
  dueAtOf,
  isoDow,
  isValidWeekKey,
  occurrenceDates,
  openAtOf,
  shiftWeek,
  toDateStr,
  weekKeyFromStart,
  weekKeyOf,
  weekRange,
  weekStartFromKey,
  weekStartOf,
} from './week.js';

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

describe('date-string helpers (spec v2)', () => {
  it('weekStartOf: thứ Hai của tuần, nhận cả Date lẫn chuỗi ngày', () => {
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05');
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05');
    expect(weekStartOf(new Date('2026-10-11T16:59:59Z'))).toBe('2026-10-05');
    expect(weekStartOf(new Date('2026-10-11T17:00:00Z'))).toBe('2026-10-12');
  });

  it('addDays qua ranh giới năm', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2027-01-04', -7)).toBe('2026-12-28');
  });

  it('weekKeyFromStart / weekStartFromKey khép kín, kể cả tuần 53', () => {
    expect(weekKeyFromStart('2026-12-28')).toBe('2026-W53');
    expect(weekKeyFromStart('2027-01-04')).toBe('2027-W01');
    expect(weekStartFromKey('2026-W41')).toBe('2026-10-05');
    expect(weekStartFromKey('2026-W53')).toBe('2026-12-28');
    expect(weekStartFromKey('2027-W01')).toBe('2027-01-04');
  });

  it('T-06: chuỗi tuần 2026-W51 … 2027-W03 liên tục bằng addDays(weekStart, 7)', () => {
    let ws = weekStartFromKey('2026-W51');
    const keys: string[] = [];
    for (let i = 0; i < 5; i++) {
      keys.push(weekKeyFromStart(ws));
      ws = addDays(ws, 7);
    }
    expect(keys).toEqual(['2026-W51', '2026-W52', '2026-W53', '2027-W01', '2027-W02']);
  });

  it('isoDow và occurrenceDates', () => {
    expect(isoDow('2026-10-05')).toBe(1);
    expect(isoDow('2026-10-11')).toBe(7);
    expect(occurrenceDates('2026-10-05', [7, 1, 4])).toEqual(['2026-10-05', '2026-10-08', '2026-10-11']);
  });

  it('dueAtOf / openAtOf theo giờ VN', () => {
    expect(dueAtOf('2026-10-11', '21:00').toISOString()).toBe('2026-10-11T14:00:00.000Z');
    expect(dueAtOf('2026-10-11', '23:59').toISOString()).toBe('2026-10-11T16:59:00.000Z');
    expect(openAtOf('2026-10-11').toISOString()).toBe('2026-10-10T17:00:00.000Z');
  });

  it('toDateStr / currentWeekStart theo giờ VN', () => {
    expect(toDateStr(new Date('2026-10-11T17:30:00Z'))).toBe('2026-10-12');
    expect(currentWeekStart(new Date('2026-10-11T16:00:00Z'))).toBe('2026-10-05');
  });
});

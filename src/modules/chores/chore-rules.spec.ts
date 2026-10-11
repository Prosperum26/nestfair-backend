import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { normalizeChore } from './chore-rules.js';

describe('normalizeChore', () => {
  it('DAILY luôn là cả 7 ngày và mặc định PER_OCCURRENCE', () => {
    expect(normalizeChore({ frequency: 'DAILY', recurrenceDays: [3] })).toEqual({
      frequency: 'DAILY',
      recurrenceDays: [1, 2, 3, 4, 5, 6, 7],
      dueTime: '21:00',
      rotationMode: 'PER_OCCURRENCE',
      occurrenceGap: 1,
    });
  });

  it('ADHOC không có ngày lặp và không xoay vòng', () => {
    expect(normalizeChore({ frequency: 'ADHOC', recurrenceDays: [1, 2], rotationMode: 'PER_OCCURRENCE' })).toMatchObject({
      recurrenceDays: [],
      rotationMode: 'WEEK_BLOCK',
    });
  });

  it('WEEKLY: sắp xếp, bỏ trùng; < 3 ngày mặc định WEEK_BLOCK, ≥ 3 ngày mặc định PER_OCCURRENCE', () => {
    expect(normalizeChore({ frequency: 'WEEKLY', recurrenceDays: [5, 2, 2] })).toMatchObject({
      recurrenceDays: [2, 5],
      rotationMode: 'WEEK_BLOCK',
    });
    expect(normalizeChore({ frequency: 'WEEKLY', recurrenceDays: [1, 3, 5] }).rotationMode).toBe('PER_OCCURRENCE');
  });

  it('Admin chọn chế độ rõ ràng thì giữ nguyên, kể cả trái mặc định', () => {
    expect(normalizeChore({ frequency: 'WEEKLY', recurrenceDays: [1, 3, 5], rotationMode: 'WEEK_BLOCK' }).rotationMode).toBe('WEEK_BLOCK');
    expect(normalizeChore({ frequency: 'DAILY', recurrenceDays: [], rotationMode: 'WEEK_BLOCK' }).rotationMode).toBe('WEEK_BLOCK');
  });

  it('WEEKLY không có ngày nào bị từ chối bằng thông báo tiếng Việt', () => {
    expect(() => normalizeChore({ frequency: 'WEEKLY', recurrenceDays: [] })).toThrow(BadRequestException);
    expect(() => normalizeChore({ frequency: 'WEEKLY', recurrenceDays: [] })).toThrow('Chọn ít nhất một ngày');
  });

  it('dueTime và occurrenceGap được giữ khi hợp lệ', () => {
    expect(normalizeChore({ frequency: 'WEEKLY', recurrenceDays: [1], dueTime: '18:30', occurrenceGap: 2 })).toMatchObject({
      dueTime: '18:30',
      occurrenceGap: 2,
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import type { ChoreFrequency, RotationMode } from '../../generated/prisma/enums.js';

export interface ChoreShapeInput {
  frequency: ChoreFrequency;
  recurrenceDays?: number[];
  dueTime?: string;
  rotationMode?: RotationMode;
  occurrenceGap?: number;
}

export interface ChoreShape {
  frequency: ChoreFrequency;
  recurrenceDays: number[];
  dueTime: string;
  rotationMode: RotationMode;
  occurrenceGap: number;
}

export const DEFAULT_DUE_TIME = '21:00';
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Chuẩn hóa hình dạng việc (spec §3, S-10…S-12): DAILY là cả tuần, ADHOC không lặp, WEEKLY cần ít nhất một ngày.
 * Chế độ xoay mặc định: lặp ≥ 3 ngày / tuần → PER_OCCURRENCE, ngược lại WEEK_BLOCK; Admin chọn rõ thì giữ nguyên.
 */
export function normalizeChore(input: ChoreShapeInput): ChoreShape {
  const days =
    input.frequency === 'DAILY'
      ? ALL_DAYS
      : input.frequency === 'ADHOC'
        ? []
        : [...new Set(input.recurrenceDays ?? [])].sort((a, b) => a - b);
  if (input.frequency === 'WEEKLY' && days.length === 0) {
    throw new BadRequestException('Chọn ít nhất một ngày trong tuần cho việc lặp hằng tuần.');
  }
  const rotationMode: RotationMode =
    input.frequency === 'ADHOC' ? 'WEEK_BLOCK' : (input.rotationMode ?? (days.length >= 3 ? 'PER_OCCURRENCE' : 'WEEK_BLOCK'));
  return {
    frequency: input.frequency,
    recurrenceDays: days,
    dueTime: input.dueTime ?? DEFAULT_DUE_TIME,
    rotationMode,
    occurrenceGap: input.occurrenceGap ?? 1,
  };
}

import { HttpStatus } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { DateStr } from './week.js';

/** "YYYY-MM-DD" có phải ngày có thật không (loại 2026-02-30, tháng 13...). */
function isRealDate(d: DateStr): boolean {
  const date = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === d;
}

/** Khoảng ngày gồm cả hai đầu: cả hai ngày phải có thật và `end >= start`. */
export function assertDateRange(start: DateStr, end: DateStr): void {
  if (!isRealDate(start) || !isRealDate(end)) {
    throw coded(HttpStatus.BAD_REQUEST, 'INVALID_DATE_RANGE', 'Ngày không hợp lệ, định dạng đúng là 2026-10-12.');
  }
  if (end < start) throw coded(HttpStatus.BAD_REQUEST, 'INVALID_DATE_RANGE', 'Ngày kết thúc phải sau hoặc trùng ngày bắt đầu.');
}

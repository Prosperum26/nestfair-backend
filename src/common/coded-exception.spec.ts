import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { coded } from './coded-exception.js';

describe('coded', () => {
  it('giữ format NestJS chuẩn và thêm trường code', () => {
    const ex = coded(HttpStatus.CONFLICT, 'ASSIGNMENT_STATE_CHANGED', 'Ca vừa đổi trạng thái.');
    expect(ex.getStatus()).toBe(409);
    expect(ex.getResponse()).toEqual({
      statusCode: 409,
      message: 'Ca vừa đổi trạng thái.',
      error: 'Conflict',
      code: 'ASSIGNMENT_STATE_CHANGED',
    });
  });

  it('tên lỗi theo mã HTTP khác', () => {
    expect(coded(HttpStatus.UNPROCESSABLE_ENTITY, 'WEEK_OUT_OF_RANGE', 'x').getResponse()).toMatchObject({
      error: 'Unprocessable Entity',
    });
    expect(coded(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_IMAGE', 'x').getResponse()).toMatchObject({
      error: 'Unsupported Media Type',
    });
  });

  it('trường thêm đi kèm nhưng không đè trường chuẩn', () => {
    expect(coded(HttpStatus.CONFLICT, 'WHEEL_BUSY', 'Đợi chút', { retryAfterMs: 4200, code: 'X' }).getResponse()).toEqual({
      statusCode: 409,
      message: 'Đợi chút',
      error: 'Conflict',
      code: 'WHEEL_BUSY',
      retryAfterMs: 4200,
    });
  });
});

import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertItemizedItems, clearAssignees, itemsForStorage, parseStoredItems } from './expense-items.js';

const caught = (fn: () => void): HttpException => {
  try {
    fn();
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('không ném lỗi');
};

describe('itemsForStorage', () => {
  const input = [{ name: 'a', lineTotal: 100, userIds: ['u1', 'u2'] }];

  it('giữ userIds khi chia theo món', () => {
    expect(itemsForStorage(input, 'ITEMIZED')).toEqual([{ name: 'a', lineTotal: 100, userIds: ['u1', 'u2'] }]);
  });

  it('bỏ userIds khi kiểu chia khác (chỉ lưu tên và tiền)', () => {
    for (const type of ['EQUAL', 'CUSTOM', 'EXACT'] as const) {
      expect(itemsForStorage(input, type)).toEqual([{ name: 'a', lineTotal: 100, userIds: [] }]);
    }
  });

  it('thiếu userIds thì lưu []', () => {
    expect(itemsForStorage([{ name: 'a', lineTotal: 5 }], 'ITEMIZED')).toEqual([{ name: 'a', lineTotal: 5, userIds: [] }]);
  });

  it('trả [] khi undefined hoặc rỗng', () => {
    expect(itemsForStorage(undefined, 'ITEMIZED')).toEqual([]);
    expect(itemsForStorage([], 'EQUAL')).toEqual([]);
  });
});

describe('parseStoredItems (JSON đọc từ DB, không tin)', () => {
  it('không phải mảng thì trả []', () => {
    for (const bad of [null, undefined, 5, 'x', { a: 1 }, true]) {
      expect(parseStoredItems(bad), JSON.stringify(bad) ?? 'undefined').toEqual([]);
    }
  });

  it('lọc phần tử hỏng, giữ phần tử đúng', () => {
    const stored = [{ name: 'a', lineTotal: 5, userIds: ['u'] }, { name: 1 }, null, { name: 'b', lineTotal: 2.5 }, { name: 'c' }];
    expect(parseStoredItems(stored)).toEqual([{ name: 'a', lineTotal: 5, userIds: ['u'] }]);
  });

  it('userIds sai kiểu thì thành []; phần tử không phải chuỗi bị bỏ', () => {
    expect(parseStoredItems([{ name: 'a', lineTotal: 5, userIds: 'u' }])).toEqual([{ name: 'a', lineTotal: 5, userIds: [] }]);
    expect(parseStoredItems([{ name: 'a', lineTotal: 5, userIds: ['u', 3, null] }])).toEqual([{ name: 'a', lineTotal: 5, userIds: ['u'] }]);
  });
});

describe('clearAssignees', () => {
  it('xóa userIds, giữ tên và tiền', () => {
    expect(clearAssignees([{ name: 'a', lineTotal: 9, userIds: ['u1'] }])).toEqual([{ name: 'a', lineTotal: 9, userIds: [] }]);
  });
});

describe('assertItemizedItems', () => {
  it('ném 400 ITEMS_INVALID khi danh sách rỗng', () => {
    const e = caught(() => assertItemizedItems([]));
    expect(e.getStatus()).toBe(400);
    expect((e.getResponse() as { code: string }).code).toBe('ITEMS_INVALID');
  });

  it('ném 400 ITEMS_INVALID khi có món không người dùng (userIds rỗng hoặc thiếu)', () => {
    for (const items of [[{ userIds: ['u'] }, { userIds: [] }], [{}]]) {
      const e = caught(() => assertItemizedItems(items));
      expect(e.getStatus()).toBe(400);
      expect((e.getResponse() as { code: string }).code).toBe('ITEMS_INVALID');
    }
  });

  it('không ném khi mọi món có ít nhất một người', () => {
    expect(() => assertItemizedItems([{ userIds: ['u1'] }, { userIds: ['u1', 'u2'] }])).not.toThrow();
  });
});

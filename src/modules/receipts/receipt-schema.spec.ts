import { describe, expect, it } from 'vitest';
import { ExtractorError } from './receipt-extractor.js';
import { parseRawReceipt, RECEIPT_SYSTEM_PROMPT, receiptResponseSchema } from './receipt-schema.js';

const unreadable = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ExtractorError);
    expect((e as ExtractorError).reason).toBe('UNREADABLE');
    return;
  }
  throw new Error('mong đợi ném ExtractorError UNREADABLE');
};

describe('parseRawReceipt', () => {
  it('JSON đúng schema → RawReceipt, ngày rỗng thành null', () => {
    const raw = parseRawReceipt(
      JSON.stringify({
        merchant: 'Circle K',
        purchasedAt: '',
        items: [{ name: 'Nước suối', quantity: 2, lineTotal: 12_000, uncertain: false }],
        total: 12_000,
        warnings: ['Ảnh hơi mờ'],
      }),
    );
    expect(raw).toEqual({
      merchant: 'Circle K',
      purchasedAt: null,
      items: [{ name: 'Nước suối', quantity: 2, lineTotal: 12_000, uncertain: false, note: undefined }],
      total: 12_000,
      warnings: ['Ảnh hơi mờ'],
    });
  });

  it('thiếu merchant hoặc warnings thì dùng mặc định rỗng (Gemini hay bỏ trường rỗng)', () => {
    const raw = parseRawReceipt(JSON.stringify({ items: [], total: 0 }));
    expect(raw).toMatchObject({ merchant: '', purchasedAt: null, items: [], total: 0, warnings: [] });
  });

  it('chuỗi không phải JSON, JSON không phải object, thiếu total, items không phải mảng → UNREADABLE', () => {
    unreadable(() => parseRawReceipt('xin lỗi, tôi không đọc được ảnh'));
    unreadable(() => parseRawReceipt(''));
    unreadable(() => parseRawReceipt('[]'));
    unreadable(() => parseRawReceipt('null'));
    unreadable(() => parseRawReceipt(JSON.stringify({ merchant: 'x', items: [] })));
    unreadable(() => parseRawReceipt(JSON.stringify({ merchant: 'x', items: 'abc', total: 1000 })));
    unreadable(() => parseRawReceipt(JSON.stringify({ merchant: 'x', items: [], total: '245.000' })));
  });

  it('món sai kiểu (thiếu lineTotal, lineTotal là chuỗi, không phải object) → UNREADABLE', () => {
    unreadable(() => parseRawReceipt(JSON.stringify({ items: [{ name: 'a' }], total: 1000 })));
    unreadable(() => parseRawReceipt(JSON.stringify({ items: [{ name: 'a', lineTotal: '1000' }], total: 1000 })));
    unreadable(() => parseRawReceipt(JSON.stringify({ items: ['a'], total: 1000 })));
  });
});

describe('receiptResponseSchema và prompt', () => {
  it('theo đặc tả VI.4 và bổ sung uncertain / note cho từng món (D8)', () => {
    expect(receiptResponseSchema.required).toEqual(['merchant', 'items', 'total', 'warnings']);
    const item = receiptResponseSchema.properties?.items?.items;
    expect(Object.keys(item?.properties ?? {})).toEqual(expect.arrayContaining(['name', 'quantity', 'lineTotal', 'uncertain', 'note']));
    expect(item?.required).toEqual(['name', 'lineTotal']);
  });

  it('prompt hệ thống giữ các ràng buộc nghiệp vụ: chỉ đọc, không suy đoán, không tách VAT, ảnh lạ thì items rỗng', () => {
    expect(RECEIPT_SYSTEM_PROMPT).toContain('Chỉ đọc những gì có trên ảnh');
    expect(RECEIPT_SYSTEM_PROMPT).toContain('Không tách thuế VAT');
    expect(RECEIPT_SYSTEM_PROMPT).toContain('items = []');
  });
});

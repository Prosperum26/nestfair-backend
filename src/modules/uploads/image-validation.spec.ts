import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, validateImageFile } from './image-validation.js';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

const file = (mimetype: string, head: number[], size = 1024) => ({
  mimetype,
  size,
  buffer: Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, size - head.length))]),
});

describe('validateImageFile', () => {
  it('nhận jpeg, png, webp hợp lệ', () => {
    expect(() => validateImageFile(file('image/png', PNG))).not.toThrow();
    expect(() => validateImageFile(file('image/jpeg', JPEG))).not.toThrow();
    expect(() => validateImageFile(file('image/webp', WEBP))).not.toThrow();
  });

  it('không có file → 400', () => {
    expect(() => validateImageFile(undefined)).toThrow('Hãy chọn ảnh minh chứng.');
  });

  it('định dạng khác jpeg/png/webp → 400', () => {
    expect(() => validateImageFile(file('image/gif', [0x47, 0x49, 0x46]))).toThrow('JPG, PNG hoặc WEBP');
  });

  it('quá 5MB → 400, đúng 5MB vẫn nhận', () => {
    expect(() => validateImageFile(file('image/png', PNG, MAX_IMAGE_BYTES + 1))).toThrow('5MB');
    expect(() => validateImageFile(file('image/png', PNG, MAX_IMAGE_BYTES))).not.toThrow();
  });

  it('khai báo image/png nhưng nội dung không phải ảnh → 400', () => {
    expect(() => validateImageFile(file('image/png', [0x68, 0x65, 0x6c, 0x6c, 0x6f]))).toThrow('không hợp lệ');
  });
});

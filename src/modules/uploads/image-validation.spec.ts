import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, sha256, validateImageFile } from './image-validation.js';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

const file = (mimetype: string, head: number[], size = 1024) => ({
  mimetype,
  size,
  buffer: Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, size - head.length))]),
});

/** Bắt lỗi HttpException để đọc mã HTTP và `code`. */
function fail(fn: () => void): { status: number; body: Record<string, unknown> } {
  try {
    fn();
  } catch (e) {
    const ex = e as { getStatus: () => number; getResponse: () => Record<string, unknown> };
    return { status: ex.getStatus(), body: ex.getResponse() };
  }
  throw new Error('không ném lỗi');
}

describe('validateImageFile', () => {
  it('nhận jpeg, png, webp hợp lệ', () => {
    expect(() => validateImageFile(file('image/png', PNG))).not.toThrow();
    expect(() => validateImageFile(file('image/jpeg', JPEG))).not.toThrow();
    expect(() => validateImageFile(file('image/webp', WEBP))).not.toThrow();
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('mimetype trùng tên thuộc tính của Object (%s) → 415', (mimetype) => {
    const r = fail(() => validateImageFile(file(mimetype, PNG)));
    expect(r.status).toBe(415);
    expect(r.body).toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
  });

  it('không có file → 400 PROOF_REQUIRED', () => {
    const r = fail(() => validateImageFile(undefined));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'PROOF_REQUIRED', message: 'Hãy chọn ảnh minh chứng.' });
  });

  it('định dạng khác jpeg/png/webp → 415 UNSUPPORTED_IMAGE', () => {
    const r = fail(() => validateImageFile(file('image/gif', [0x47, 0x49, 0x46])));
    expect(r.status).toBe(415);
    expect(r.body).toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
    expect(String(r.body.message)).toContain('JPG, PNG hoặc WEBP');
  });

  it('quá 5MB → 413 IMAGE_TOO_LARGE, đúng 5MB vẫn nhận', () => {
    const r = fail(() => validateImageFile(file('image/png', PNG, MAX_IMAGE_BYTES + 1)));
    expect(r.status).toBe(413);
    expect(r.body).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(() => validateImageFile(file('image/png', PNG, MAX_IMAGE_BYTES))).not.toThrow();
  });

  it('khai báo image/png nhưng nội dung không phải ảnh (magic bytes) → 415', () => {
    const r = fail(() => validateImageFile(file('image/png', [0x68, 0x65, 0x6c, 0x6c, 0x6f])));
    expect(r.status).toBe(415);
    expect(r.body).toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
  });
});

describe('sha256', () => {
  it('cùng nội dung cùng băm, khác nội dung khác băm', () => {
    expect(sha256(Buffer.from('a'))).toBe(sha256(Buffer.from('a')));
    expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
    expect(sha256(Buffer.from('a'))).toMatch(/^[0-9a-f]{64}$/);
  });
});

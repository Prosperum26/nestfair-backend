import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { coded } from '../../common/coded-exception.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

/** Kiểm tra cả mimetype khai báo lẫn chữ ký file (magic bytes), tránh giả mạo đuôi/MIME. */
const SIGNATURES: Record<string, (buf: Buffer) => boolean> = {
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
};

const UNSUPPORTED = 'Chỉ nhận ảnh JPG, PNG hoặc WEBP.';

/**
 * Ném lỗi có mã nếu không phải ảnh jpeg/png/webp ≤ 5MB:
 * 400 `PROOF_REQUIRED`, 415 `UNSUPPORTED_IMAGE`, 413 `IMAGE_TOO_LARGE`.
 */
export function validateImageFile(file: UploadedImage | undefined): asserts file is UploadedImage {
  if (!file) throw coded(HttpStatus.BAD_REQUEST, 'PROOF_REQUIRED', 'Hãy chọn ảnh minh chứng.');
  const matches = SIGNATURES[file.mimetype];
  if (!matches) throw coded(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_IMAGE', UNSUPPORTED);
  if (file.size > MAX_IMAGE_BYTES) throw coded(HttpStatus.PAYLOAD_TOO_LARGE, 'IMAGE_TOO_LARGE', 'Ảnh tối đa 5MB.');
  if (!matches(file.buffer)) throw coded(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'UNSUPPORTED_IMAGE', UNSUPPORTED);
}

/** SHA-256 hex của ảnh, dùng chặn nộp lại ảnh cũ. */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

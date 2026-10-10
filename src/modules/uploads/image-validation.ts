import { BadRequestException } from '@nestjs/common';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  bytes.every((b, i) => buf[offset + i] === b);

/** Kiểm tra cả mimetype khai báo lẫn chữ ký file (magic bytes), tránh giả mạo đuôi/MIME. */
const SIGNATURES: Record<string, (buf: Buffer) => boolean> = {
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': (b) =>
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
};

/** Ném 400 (tiếng Việt) nếu không phải ảnh jpeg/png/webp ≤ 5MB. */
export function validateImageFile(file: UploadedImage | undefined): asserts file is UploadedImage {
  if (!file) throw new BadRequestException('Hãy chọn ảnh minh chứng.');
  const matches = SIGNATURES[file.mimetype];
  if (!matches) throw new BadRequestException('Chỉ nhận ảnh JPG, PNG hoặc WEBP.');
  if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('Ảnh tối đa 5MB.');
  if (!matches(file.buffer)) throw new BadRequestException('Tệp ảnh không hợp lệ.');
}

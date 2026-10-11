import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CloudinaryService, publicIdFromUrl } from './cloudinary.service.js';

describe('CloudinaryService', () => {
  it('thiếu cấu hình Cloudinary → 503, không gọi mạng', async () => {
    const config = { get: () => undefined } as unknown as ConfigService<never, true>;
    const svc = new CloudinaryService(config);
    await expect(svc.upload(Buffer.from('x'), 'chores')).rejects.toMatchObject({ status: 503 });
  });

  it('destroy khi chưa cấu hình thì bỏ qua, không ném lỗi (dọn dẹp không được làm hỏng luồng chính)', async () => {
    const config = { get: () => undefined } as unknown as ConfigService<never, true>;
    await expect(new CloudinaryService(config).destroy('nestfair/houses/h/proofs/abc')).resolves.toBeUndefined();
  });
});

describe('publicIdFromUrl', () => {
  it('lấy public_id (kèm thư mục, bỏ phiên bản và đuôi file)', () => {
    expect(publicIdFromUrl('https://res.cloudinary.com/demo/image/upload/v1760000000/nestfair/houses/h1/proofs/abc123.png')).toBe(
      'nestfair/houses/h1/proofs/abc123',
    );
    expect(publicIdFromUrl('https://res.cloudinary.com/demo/image/upload/nestfair/houses/h1/proofs/abc123.webp')).toBe('nestfair/houses/h1/proofs/abc123');
  });

  it('URL không phải của Cloudinary hoặc không có đoạn upload thì trả null', () => {
    expect(publicIdFromUrl('https://example.com/a.png')).toBeNull();
    expect(publicIdFromUrl('https://res.cloudinary.com/demo/raw/other/x.png')).toBeNull();
    expect(publicIdFromUrl('not a url')).toBeNull();
  });
});

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CloudinaryService } from './cloudinary.service.js';

describe('CloudinaryService', () => {
  it('thiếu cấu hình Cloudinary → 503, không gọi mạng', async () => {
    const config = { get: () => undefined } as unknown as ConfigService<never, true>;
    const svc = new CloudinaryService(config);
    await expect(svc.upload(Buffer.from('x'), 'chores')).rejects.toMatchObject({
      status: 503,
    });
  });
});

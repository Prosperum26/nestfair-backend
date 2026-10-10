import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { Env } from '../../config/env.validation.js';

/** Upload ảnh lên Cloudinary. Việc kiểm tra định dạng/dung lượng làm ở validateImageFile. */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async upload(buffer: Buffer, folder: string): Promise<{ url: string }> {
    const cloud_name = this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    const api_key = this.config.get('CLOUDINARY_API_KEY', { infer: true });
    const api_secret = this.config.get('CLOUDINARY_API_SECRET', { infer: true });
    if (!cloud_name || !api_key || !api_secret) {
      throw new ServiceUnavailableException('Chưa cấu hình lưu ảnh, hãy liên hệ trưởng phòng.');
    }
    cloudinary.config({ cloud_name, api_key, api_secret, secure: true });

    try {
      return await new Promise<{ url: string }>((resolve, reject) => {
        cloudinary.uploader
          .upload_stream({ folder: `nestfair/${folder}`, resource_type: 'image' }, (err, result) =>
            err || !result ? reject(err ?? new Error('empty result')) : resolve({ url: result.secure_url }),
          )
          .end(buffer);
      });
    } catch (e) {
      this.logger.error('Upload Cloudinary thất bại', e as Error);
      throw new BadGatewayException('Không tải được ảnh lên, thử lại sau ít phút.');
    }
  }
}

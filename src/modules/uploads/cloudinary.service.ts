import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { Env } from '../../config/env.validation.js';

/** public_id (kèm thư mục, không phiên bản/đuôi) từ URL ảnh Cloudinary; null nếu không phải URL Cloudinary. */
export function publicIdFromUrl(url: string): string | null {
  const m = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(?:v\d+\/)?(.+)\.[A-Za-z0-9]+$/.exec(url);
  return m ? m[1] : null;
}

/** Upload / xóa ảnh trên Cloudinary. Việc kiểm tra định dạng và dung lượng làm ở validateImageFile. */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** Trả null nếu chưa cấu hình. */
  private credentials() {
    const cloud_name = this.config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    const api_key = this.config.get('CLOUDINARY_API_KEY', { infer: true });
    const api_secret = this.config.get('CLOUDINARY_API_SECRET', { infer: true });
    return cloud_name && api_key && api_secret ? { cloud_name, api_key, api_secret, secure: true } : null;
  }

  /** `folder` tương đối, ví dụ `houses/<houseId>/proofs`; tên file do Cloudinary đặt ngẫu nhiên. */
  async upload(buffer: Buffer, folder: string): Promise<{ url: string; publicId: string }> {
    const creds = this.credentials();
    if (!creds) throw new ServiceUnavailableException({ statusCode: 503, message: 'Chưa cấu hình lưu ảnh, hãy liên hệ trưởng phòng.', error: 'Service Unavailable', code: 'UPLOAD_UNAVAILABLE' });
    cloudinary.config(creds);

    try {
      return await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            { folder: `nestfair/${folder}`, resource_type: 'image', use_filename: false, unique_filename: true },
            (err, result) => (err || !result ? reject(err ?? new Error('empty result')) : resolve({ url: result.secure_url, publicId: result.public_id })),
          )
          .end(buffer);
      });
    } catch (e) {
      this.logger.error('Upload Cloudinary thất bại', e as Error);
      throw new BadGatewayException({ statusCode: 502, message: 'Không tải được ảnh lên, thử lại sau ít phút.', error: 'Bad Gateway', code: 'UPLOAD_UNAVAILABLE' });
    }
  }

  /** Xóa ảnh. Dọn dẹp không được làm hỏng luồng chính nên lỗi chỉ được ghi log. */
  async destroy(publicId: string): Promise<void> {
    const creds = this.credentials();
    if (!creds) return;
    cloudinary.config(creds);
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    } catch (e) {
      this.logger.warn(`Không xóa được ảnh ${publicId}: ${(e as Error).message}`);
    }
  }
}

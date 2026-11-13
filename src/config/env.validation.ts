import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  Max,
  Min,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export class Env {
  @Type(() => Number)
  @IsInt()
  PORT: number = 5000;

  @IsIn(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @IsString()
  CORS_ORIGINS = 'http://localhost:5173';

  // Số proxy đứng trước server (Render = 1, Cloudflare + Render = 2). 0 = không tin X-Forwarded-For.
  // Sai số này thì throttle theo IP hỏng: quá thấp = mọi người chung IP proxy, quá cao = client giả được IP.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS: number = 0;

  // sameSite của cookie refresh. Để trống = production `none`, máy dev `lax`.
  // FE và API cùng tên miền (app.x, api.x) thì đặt `lax`: trình duyệt tự chặn CSRF.
  @IsOptional()
  @IsIn(['lax', 'strict', 'none'])
  COOKIE_SAME_SITE?: 'lax' | 'strict' | 'none';

  @IsString()
  PUBLIC_WEB_URL = 'http://localhost:5173';

  @IsString()
  DATABASE_URL: string;

  @IsString()
  @MinLength(64)
  JWT_SECRET: string;

  @Type(() => Number)
  @IsInt()
  JWT_ACCESS_TTL_MINUTES: number = 15;

  @Type(() => Number)
  @IsInt()
  REFRESH_TOKEN_TTL_DAYS: number = 7;

  // Cloudinary: để trống = tắt upload ảnh (check-in trả 503).
  @IsOptional()
  @IsString()
  CLOUDINARY_CLOUD_NAME?: string;

  @IsOptional()
  @IsString()
  CLOUDINARY_API_KEY?: string;

  @IsOptional()
  @IsString()
  CLOUDINARY_API_SECRET?: string;

  // Cách gọn: cloudinary://<api_key>:<api_secret>@<cloud_name>. 3 biến ở trên (nếu có) được ưu tiên.
  @IsOptional()
  @IsString()
  CLOUDINARY_URL?: string;

  // Gemini (OCR hóa đơn): để trống key = tắt OCR, quét trả về nhập tay. Có key thì bắt buộc khai báo model.
  @IsOptional()
  @IsString()
  GEMINI_API_KEY?: string;

  @ValidateIf((o: Env) => !!o.GEMINI_API_KEY)
  @IsString()
  @MinLength(1)
  GEMINI_MODEL?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CALLBACK_URL?: string;
}

/** Chạy lúc khởi động: thiếu hoặc sai biến môi trường thì dừng server ngay. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { enableImplicitConversion: true });
  const errors = validateSync(env);
  if (errors.length > 0) {
    const detail = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n');
    throw new Error(`Biến môi trường không hợp lệ:\n${detail}`);
  }
  return env;
}

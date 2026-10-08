import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
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

  @IsString()
  PUBLIC_WEB_URL = 'http://localhost:5173';

  @IsString()
  DATABASE_URL: string;

  @IsString()
  @MinLength(64)
  JWT_SECRET: string;

  @IsString()
  JWT_ACCESS_TTL = '15m';

  @Type(() => Number)
  @IsInt()
  REFRESH_TOKEN_TTL_DAYS: number = 7;

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

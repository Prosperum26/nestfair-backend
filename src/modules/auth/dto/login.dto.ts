import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'hung.tm@student.uit.edu.vn', description: 'Account email. Trimmed and lower-cased before lookup.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email: string;

  @ApiProperty({ example: 'Password123', maxLength: 72, description: 'Account password.' })
  @IsString()
  @MinLength(1, { message: 'Bạn chưa nhập mật khẩu.' })
  @MaxLength(72)
  password: string;

  @ApiPropertyOptional({
    default: true,
    description: 'true (default) keeps the session for 7 days; false makes the refresh cookie a browser-session cookie that disappears when the browser closes.',
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'hung.tm@student.uit.edu.vn' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  email: string;

  @ApiProperty({ example: 'MatKhau123' })
  @IsString()
  @MinLength(1, { message: 'Bạn chưa nhập mật khẩu.' })
  @MaxLength(72)
  password: string;

  @ApiPropertyOptional({
    default: true,
    description: 'false = phiên mất khi đóng trình duyệt.',
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

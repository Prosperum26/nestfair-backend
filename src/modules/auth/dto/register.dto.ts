import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @ApiProperty({ example: 'Minh Hung Tran', minLength: 2, maxLength: 80, description: 'Full name shown to housemates. Trimmed; 2-80 characters.' })
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'Họ và tên cần từ 2 đến 80 ký tự.' })
  fullName: string;

  @ApiProperty({ example: 'hung.tm@student.uit.edu.vn', maxLength: 254, description: 'Sign-in email. Trimmed and lower-cased; must be unique across accounts.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: '0901234567',
    pattern: '^0\\d{9}$',
    description: 'Vietnamese mobile number: 10 digits starting with 0. Whitespace is ignored.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
  @Matches(/^0\d{9}$/, { message: 'Số điện thoại cần 10 số, bắt đầu bằng 0.' })
  phone: string;

  @ApiProperty({
    example: 'Password123',
    minLength: 8,
    maxLength: 72,
    description: '8-72 characters with at least one upper-case letter and one digit. Limited to 72 because bcrypt ignores longer input.',
  })
  @IsString()
  // bcrypt chỉ dùng 72 byte đầu, chặn dài hơn để không có mật khẩu "cắt ngầm".
  @Length(8, 72, { message: 'Mật khẩu cần từ 8 đến 72 ký tự.' })
  @Matches(/(?=.*[A-Z])(?=.*\d)/, { message: 'Mật khẩu cần có chữ hoa và số.' })
  password: string;
}

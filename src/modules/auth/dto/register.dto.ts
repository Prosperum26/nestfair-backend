import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @ApiProperty({ example: 'Trần Minh Hùng' })
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'Họ và tên cần từ 2 đến 80 ký tự.' })
  fullName: string;

  @ApiProperty({ example: 'hung.tm@student.uit.edu.vn' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Email không hợp lệ.' })
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: '0901234567',
    description: '10 số, bắt đầu bằng 0. Khoảng trắng được bỏ qua.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
  @Matches(/^0\d{9}$/, { message: 'Số điện thoại cần 10 số, bắt đầu bằng 0.' })
  phone: string;

  @ApiProperty({
    example: 'MatKhau123',
    description: '8–72 ký tự, có chữ hoa và số.',
  })
  @IsString()
  // bcrypt chỉ dùng 72 byte đầu, chặn dài hơn để không có mật khẩu "cắt ngầm".
  @Length(8, 72, { message: 'Mật khẩu cần từ 8 đến 72 ký tự.' })
  @Matches(/(?=.*[A-Z])(?=.*\d)/, { message: 'Mật khẩu cần có chữ hoa và số.' })
  password: string;
}

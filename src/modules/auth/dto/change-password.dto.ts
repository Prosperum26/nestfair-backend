import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Mật khẩu hiện tại.' })
  @IsString()
  @Length(1, 72, { message: 'Hãy nhập mật khẩu hiện tại.' })
  currentPassword: string;

  @ApiProperty({ description: '8–72 ký tự, có chữ hoa và số.' })
  @IsString()
  // bcrypt chỉ dùng 72 byte đầu, chặn dài hơn để không có mật khẩu "cắt ngầm".
  @Length(8, 72, { message: 'Mật khẩu cần từ 8 đến 72 ký tự.' })
  @Matches(/(?=.*[A-Z])(?=.*\d)/, { message: 'Mật khẩu cần có chữ hoa và số.' })
  newPassword: string;
}

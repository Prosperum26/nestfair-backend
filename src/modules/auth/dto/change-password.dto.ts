import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ maxLength: 72, example: 'Password123', description: 'The current password, to prove ownership of the account.' })
  @IsString()
  @Length(1, 72, { message: 'Hãy nhập mật khẩu hiện tại.' })
  currentPassword: string;

  @ApiProperty({ minLength: 8, maxLength: 72, example: 'NewPassword456', description: 'The new password: 8-72 characters with at least one upper-case letter and one digit. Must differ from the current one.' })
  @IsString()
  // bcrypt chỉ dùng 72 byte đầu, chặn dài hơn để không có mật khẩu "cắt ngầm".
  @Length(8, 72, { message: 'Mật khẩu cần từ 8 đến 72 ký tự.' })
  @Matches(/(?=.*[A-Z])(?=.*\d)/, { message: 'Mật khẩu cần có chữ hoa và số.' })
  newPassword: string;
}

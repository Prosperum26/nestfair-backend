import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';

const stripSpaces = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, '') : value;

/**
 * Mọi field đều tùy chọn: chỉ field có gửi mới được cập nhật.
 * Gửi null cho phone / bankBin / bankAccount để xóa giá trị.
 * Email và mật khẩu không đổi được qua route này (forbidNonWhitelisted trả 400).
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Trần Minh Hùng' })
  // Không dùng IsOptional: họ tên không được xóa, gửi null phải ra 400.
  @ValidateIf((o: UpdateProfileDto) => o.fullName !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 80, { message: 'Họ và tên cần từ 2 đến 80 ký tự.' })
  fullName?: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '0901234567' })
  @IsOptional()
  @Transform(stripSpaces)
  @Matches(/^0\d{9}$/, { message: 'Số điện thoại cần 10 số, bắt đầu bằng 0.' })
  phone?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '970407',
    description:
      'Mã BIN Napas 6 số của ngân hàng (VietQR). Đi cùng bankAccount.',
  })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'Mã ngân hàng không hợp lệ.' })
  bankBin?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '19036780123',
    description: '6–19 chữ số. Đi cùng bankBin.',
  })
  @IsOptional()
  @Transform(stripSpaces)
  @Matches(/^\d{6,19}$/, { message: 'Số tài khoản cần 6–19 chữ số.' })
  bankAccount?: string | null;
}

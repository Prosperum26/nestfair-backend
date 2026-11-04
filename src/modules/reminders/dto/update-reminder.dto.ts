import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, Length, ValidateIf } from 'class-validator';

/**
 * Mọi field đều tùy chọn: chỉ field có gửi mới được cập nhật.
 * Không dùng IsOptional cho title: nội dung không được xóa, gửi null phải ra 400.
 */
export class UpdateReminderDto {
  @ApiPropertyOptional({ example: 'Đổ rác (dời tối mai)', minLength: 1, maxLength: 120 })
  @ValidateIf((o: UpdateReminderDto) => o.title !== undefined)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120, { message: 'Nội dung nhắc cần từ 1 đến 120 ký tự.' })
  title?: string;

  @ApiPropertyOptional({
    example: '2026-11-02T07:00:00+07:00',
    description: 'ISO 8601, phải sau hiện tại và trong vòng 1 năm (chỉ nhắc chưa gửi mới sửa được giờ)',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'remindAt cần là thời điểm ISO 8601.' })
  remindAt?: string;
}

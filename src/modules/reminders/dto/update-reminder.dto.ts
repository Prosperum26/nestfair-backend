import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, Length, ValidateIf } from 'class-validator';

/**
 * Mọi field đều tùy chọn: chỉ field có gửi mới được cập nhật.
 * Không dùng IsOptional cho title: nội dung không được xóa, gửi null phải ra 400.
 */
export class UpdateReminderDto {
  @ApiPropertyOptional({ example: 'Take out the trash (moved to tomorrow evening)', minLength: 1, maxLength: 120, description: 'New text (1-120 characters). It cannot be cleared: sending null is rejected.' })
  @ValidateIf((o: UpdateReminderDto) => o.title !== undefined)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120, { message: 'Nội dung nhắc cần từ 1 đến 120 ký tự.' })
  title?: string;

  @ApiPropertyOptional({
    example: '2026-11-02T07:00:00+07:00',
    description: 'New reminder time (ISO 8601). Must be in the future and within one year. Only reminders not yet sent can be changed.',
  })
  @IsOptional()
  @IsISO8601({}, { message: 'remindAt cần là thời điểm ISO 8601.' })
  remindAt?: string;
}

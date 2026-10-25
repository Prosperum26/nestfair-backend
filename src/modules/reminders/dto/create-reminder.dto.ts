import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class CreateReminderDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Nhà gắn với nhắc nhở; bạn phải là thành viên còn hoạt động của nhà này',
  })
  @IsUUID('all', { message: 'houseId không hợp lệ.' })
  houseId: string;

  @ApiProperty({
    example: 'Đóng tiền điện',
    minLength: 1,
    maxLength: 120,
    description: 'Nội dung nhắc (đã trim, 1–120 ký tự)',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120, { message: 'Nội dung nhắc cần từ 1 đến 120 ký tự.' })
  title: string;

  @ApiProperty({
    example: '2026-11-01T19:00:00+07:00',
    description: 'ISO 8601, phải sau hiện tại và trong vòng 1 năm',
  })
  @IsISO8601({}, { message: 'remindAt cần là thời điểm ISO 8601.' })
  remindAt: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Tin nhắn Trợ lý chứa nút hành động được bấm; phải đi cùng actionIndex',
  })
  @IsOptional()
  @IsUUID('all', { message: 'sourceMessageId không hợp lệ.' })
  sourceMessageId?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Vị trí hành động CREATE_REMINDER trong actionsJson của tin nhắn; phải đi cùng sourceMessageId',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'actionIndex phải là số nguyên.' })
  @Min(0, { message: 'actionIndex không được âm.' })
  actionIndex?: number;
}

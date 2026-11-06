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
    description: 'House the reminder belongs to. The caller must be an active member of it; membership is verified by the server.',
  })
  @IsUUID('all', { message: 'houseId không hợp lệ.' })
  houseId: string;

  @ApiProperty({
    example: 'Pay the electricity bill',
    minLength: 1,
    maxLength: 120,
    description: 'Text of the reminder (trimmed, 1-120 characters).',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 120, { message: 'Nội dung nhắc cần từ 1 đến 120 ký tự.' })
  title: string;

  @ApiProperty({
    example: '2026-11-01T19:00:00+07:00',
    description: 'When to remind (ISO 8601). Must be in the future and within one year, otherwise `REMIND_AT_INVALID`.',
  })
  @IsISO8601({}, { message: 'remindAt cần là thời điểm ISO 8601.' })
  remindAt: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Id of the assistant message whose suggested button was pressed. Must be sent together with `actionIndex`; then the reminder is recorded with source ASSISTANT.',
  })
  @IsOptional()
  @IsUUID('all', { message: 'sourceMessageId không hợp lệ.' })
  sourceMessageId?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Zero-based position of the `CREATE_REMINDER` action in the message\'s `actions` list. Must be sent together with `sourceMessageId`.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'actionIndex phải là số nguyên.' })
  @Min(0, { message: 'actionIndex không được âm.' })
  actionIndex?: number;
}

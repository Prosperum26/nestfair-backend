import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_REMINDER_PAGE = 50;
export const MAX_REMINDER_PAGE = 100;
export const REMINDER_STATES = ['upcoming', 'all'] as const;
export type ReminderState = (typeof REMINDER_STATES)[number];

export class ListRemindersQuery {
  @ApiPropertyOptional({
    enum: [...REMINDER_STATES],
    default: 'upcoming',
    description:
      'upcoming (mặc định) = chỉ nhắc chưa gửi (sentAt null); all = mọi nhắc. Cả hai xếp remindAt tăng dần.',
  })
  @IsOptional()
  @IsIn([...REMINDER_STATES], { message: 'state chỉ nhận upcoming hoặc all.' })
  state?: ReminderState;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_REMINDER_PAGE,
    default: DEFAULT_REMINDER_PAGE,
    description: 'Số nhắc tối đa mỗi lần gọi (1–100)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên.' })
  @Min(1, { message: 'limit tối thiểu là 1.' })
  @Max(MAX_REMINDER_PAGE, { message: 'limit tối đa là ' + MAX_REMINDER_PAGE + '.' })
  limit?: number;
}

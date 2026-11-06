import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ActivityDto {
  @ApiProperty({ format: 'uuid', description: 'Activity id.' })
  id: string;

  @ApiProperty({ example: 'chore.submitted', description: 'Kind of event, for example `chore.submitted`, `swap.accepted`, `expense.created`, `wheel.result`. The client builds the display sentence from `type` and `params`.' })
  type: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'User id of the member who caused the event; null when the system did (a scheduled job).' })
  actorUserId: string | null;

  @ApiProperty({ example: 'Pham Ngoc Mai', description: 'Name of the actor captured when the event happened ("NestFair" for system events).' })
  actorName: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { choreTitle: 'Washing dishes' }, description: 'Non-sensitive details used to fill the sentence. Never contains reasons, gift amounts or photo URLs.' })
  params: Record<string, unknown>;

  @ApiProperty({ description: 'When the event happened (ISO 8601 UTC).' })
  createdAt: Date;
}

export class ListActivityQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20, description: 'Page size when scrolling back with `before` (or without a cursor).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên.' })
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'Scroll back: only entries older than this instant (ISO 8601).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'before phải là thời điểm ISO hợp lệ.' })
  before?: Date;

  @ApiPropertyOptional({ description: 'Catch up after a reconnect: only entries newer than this instant (ISO 8601), at most 100. When present it takes precedence over `before` and `limit`.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'since phải là thời điểm ISO hợp lệ.' })
  since?: Date;
}

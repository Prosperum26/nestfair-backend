import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Ngày phải có dạng YYYY-MM-DD, ví dụ 2026-10-12.';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class CreateAbsenceDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'User id of the absent member. Omit to declare your own absence; only the admin may declare an absence for someone else.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'Người vắng không hợp lệ.' })
  userId?: string;

  @ApiProperty({ example: '2026-10-12', description: 'First absent day (YYYY-MM-DD).' })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  startDate: string;

  @ApiProperty({ example: '2026-10-14', description: 'Last absent day, inclusive (YYYY-MM-DD). Must not be before `startDate`.' })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  endDate: string;

  @ApiPropertyOptional({ maxLength: 200, example: 'Visiting family', description: 'Optional reason (up to 200 characters).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;
}

export class CreateBreakDto {
  @ApiProperty({ example: '2026-10-12', description: 'First day of the break (YYYY-MM-DD).' })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  startDate: string;

  @ApiProperty({ example: '2026-10-18', description: 'Last day of the break, inclusive (YYYY-MM-DD).' })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  endDate: string;

  @ApiPropertyOptional({ maxLength: 200, example: 'Lunar New Year', description: 'Optional reason (up to 200 characters).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;
}

export class AbsenceDto {
  @ApiProperty({ format: 'uuid', description: 'Absence id.' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'User id of the absent member.' })
  userId: string;

  @ApiProperty({ description: 'Display name of the absent member.' })
  userName: string;

  @ApiProperty({ example: '2026-10-12', description: 'First absent day (YYYY-MM-DD).' })
  startDate: string;

  @ApiProperty({ example: '2026-10-14', description: 'Last absent day, inclusive.' })
  endDate: string;

  @ApiProperty({ type: String, nullable: true, description: 'Reason, or null.' })
  reason: string | null;

  @ApiProperty({ format: 'uuid', description: 'User id of whoever declared the absence.' })
  createdById: string;

  @ApiProperty({ description: 'When it was declared (ISO 8601 UTC).' })
  createdAt: Date;
}

export class BreakDto {
  @ApiProperty({ format: 'uuid', description: 'Break id.' })
  id: string;

  @ApiProperty({ example: '2026-10-12', description: 'First day of the break.' })
  startDate: string;

  @ApiProperty({ example: '2026-10-18', description: 'Last day of the break, inclusive.' })
  endDate: string;

  @ApiProperty({ type: String, nullable: true, description: 'Reason, or null.' })
  reason: string | null;

  @ApiProperty({ description: 'When the break was created (ISO 8601 UTC).' })
  createdAt: Date;
}

export class AuditQuery {
  @ApiPropertyOptional({ example: '2026-W41', description: 'Only entries from this ISO week (house time zone). Omit to get the 100 most recent entries.' })
  @IsOptional()
  @Matches(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, { message: 'Tuần không hợp lệ, định dạng đúng là 2026-W41.' })
  week?: string;
}

export class AuditLogDto {
  @ApiProperty({ format: 'uuid', description: 'Log entry id.' })
  id: string;

  @ApiProperty({ example: 'REROLL', description: 'What happened, for example REROLL, FORCE_DONE, REASSIGN, CANCEL or an absence declaration.' })
  action: string;

  @ApiProperty({ type: String, nullable: true, description: 'House-member id of the actor; null when the system (cron job) acted.' })
  actorId: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Display name of the actor.' })
  actorName: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Assignment the action affected, if any.' })
  assignmentId: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Schedule the action affected, if any.' })
  scheduleId: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Action-specific details such as the reason or the old and new assignee.' })
  detail: Record<string, unknown>;

  @ApiProperty({ description: 'When it happened (ISO 8601 UTC).' })
  createdAt: Date;
}

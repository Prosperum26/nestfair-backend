import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'Ngày phải có dạng YYYY-MM-DD, ví dụ 2026-10-12.';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class CreateAbsenceDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'User.id người vắng. Bỏ trống = chính bạn; khai hộ người khác chỉ trưởng phòng.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'Người vắng không hợp lệ.' })
  userId?: string;

  @ApiProperty({ example: '2026-10-12' })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  startDate: string;

  @ApiProperty({ example: '2026-10-14', description: 'Gồm cả ngày này' })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  endDate: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;
}

export class CreateBreakDto {
  @ApiProperty({ example: '2026-10-12' })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  startDate: string;

  @ApiProperty({ example: '2026-10-18', description: 'Gồm cả ngày này' })
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  endDate: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;
}

export class AbsenceDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() userName: string;
  @ApiProperty({ example: '2026-10-12' }) startDate: string;
  @ApiProperty({ example: '2026-10-14' }) endDate: string;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ format: 'uuid', description: 'User.id người khai' }) createdById: string;
  @ApiProperty() createdAt: Date;
}

export class BreakDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: '2026-10-12' }) startDate: string;
  @ApiProperty({ example: '2026-10-18' }) endDate: string;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty() createdAt: Date;
}

export class AuditQuery {
  @ApiPropertyOptional({ example: '2026-W41', description: 'Chỉ lấy thao tác trong tuần này (giờ nhà); bỏ trống = 100 thao tác gần nhất' })
  @IsOptional()
  @Matches(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, { message: 'Tuần không hợp lệ, định dạng đúng là 2026-W41.' })
  week?: string;
}

export class AuditLogDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'REROLL' }) action: string;
  @ApiProperty({ type: String, nullable: true, description: 'HouseMember.id; null = hệ thống (cron)' }) actorId: string | null;
  @ApiProperty({ type: String, nullable: true }) actorName: string | null;
  @ApiProperty({ type: String, nullable: true }) assignmentId: string | null;
  @ApiProperty({ type: String, nullable: true }) scheduleId: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) detail: Record<string, unknown>;
  @ApiProperty() createdAt: Date;
}

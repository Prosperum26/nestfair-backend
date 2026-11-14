import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { RuleProposalKind, RuleProposalStatus } from '../../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
// Chuỗi rỗng coi như không gửi.
const trimOrUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** Đề xuất một thay đổi nội quy. Ràng buộc theo `kind` kiểm tra trong service (cần đọc nội quy hiện tại). */
export class CreateRuleProposalDto {
  @ApiProperty({ enum: RuleProposalKind, enumName: 'RuleProposalKind', description: '`ADD` adds a new rule, `EDIT` replaces an existing rule, `REMOVE` deletes an existing rule.' })
  @IsEnum(RuleProposalKind, { message: 'Loại đề xuất không hợp lệ.' })
  kind: RuleProposalKind;

  @ApiPropertyOptional({ maxLength: 1000, description: 'EDIT / REMOVE only: the exact current text of the rule, without its list number. The proposal is rejected if no rule matches.' })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(1000)
  targetText?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 200, description: 'ADD / EDIT only: the new rule text (1-200 characters).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200, { message: 'Nội dung cần từ 1 đến 200 ký tự.' })
  content?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Optional reason shown to the admin (up to 200 characters).' })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;
}

export class RejectRuleProposalDto {
  @ApiPropertyOptional({ maxLength: 200, description: 'Optional reason for rejecting, shown to the proposer (up to 200 characters).' })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;
}

class ProposerDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the proposer.' })
  userId: string;

  @ApiProperty({ description: 'Display name of the proposer.' })
  fullName: string;

  @ApiProperty({ nullable: true, type: String, description: 'Avatar URL of the proposer, or null.' })
  avatarUrl: string | null;
}

export class RuleProposalDto {
  @ApiProperty({ format: 'uuid', description: 'Proposal id.' })
  id: string;

  @ApiProperty({ enum: RuleProposalKind, enumName: 'RuleProposalKind', description: 'ADD, EDIT or REMOVE.' })
  kind: RuleProposalKind;

  @ApiProperty({ nullable: true, type: String, description: 'EDIT / REMOVE: the rule text as it was when proposed; null for ADD.' })
  targetText: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'ADD / EDIT: the proposed new text; null for REMOVE.' })
  content: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'Reason given by the proposer, or null.' })
  reason: string | null;

  @ApiProperty({ enum: RuleProposalStatus, enumName: 'RuleProposalStatus', description: 'PENDING until the admin decides; then APPROVED or REJECTED. WITHDRAWN when the proposer took it back.' })
  status: RuleProposalStatus;

  @ApiProperty({ type: ProposerDto, description: 'Who made the proposal.' })
  proposer: ProposerDto;

  @ApiProperty({ nullable: true, type: String, format: 'date-time', description: 'When the admin approved or rejected it; null while pending.' })
  decidedAt: Date | null;

  @ApiProperty({ nullable: true, type: String, description: 'Reason given when rejected, or null.' })
  rejectReason: string | null;

  @ApiProperty({ type: String, format: 'date-time', description: 'When the proposal was made (ISO 8601 UTC).' })
  createdAt: Date;
}

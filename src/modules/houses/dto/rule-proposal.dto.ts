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
  @ApiProperty({ enum: RuleProposalKind, description: 'ADD thêm điều mới · EDIT sửa một điều · REMOVE bỏ một điều' })
  @IsEnum(RuleProposalKind, { message: 'Loại đề xuất không hợp lệ.' })
  kind: RuleProposalKind;

  @ApiPropertyOptional({ description: 'EDIT / REMOVE: nguyên văn điều đang có (không kèm số thứ tự)' })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(1000)
  targetText?: string;

  @ApiPropertyOptional({ description: 'ADD / EDIT: nội dung mới, tối đa 200 ký tự' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 200, { message: 'Nội dung cần từ 1 đến 200 ký tự.' })
  content?: string;

  @ApiPropertyOptional({ description: 'Lý do, tối đa 200 ký tự' })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;
}

export class RejectRuleProposalDto {
  @ApiPropertyOptional({ description: 'Lý do từ chối, tối đa 200 ký tự' })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;
}

class ProposerDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ nullable: true, type: String }) avatarUrl: string | null;
}

export class RuleProposalDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: RuleProposalKind }) kind: RuleProposalKind;
  @ApiProperty({ nullable: true, type: String }) targetText: string | null;
  @ApiProperty({ nullable: true, type: String }) content: string | null;
  @ApiProperty({ nullable: true, type: String }) reason: string | null;
  @ApiProperty({ enum: RuleProposalStatus }) status: RuleProposalStatus;
  @ApiProperty({ type: ProposerDto }) proposer: ProposerDto;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' }) decidedAt: Date | null;
  @ApiProperty({ nullable: true, type: String }) rejectReason: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, ValidateIf } from 'class-validator';

export const VERIFY_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type VerifyDecision = (typeof VERIFY_DECISIONS)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class VerifyAssignmentDto {
  @ApiProperty({ enum: VERIFY_DECISIONS, description: '`APPROVED` accepts the proof and completes the assignment; `REJECTED` sends it back to the assignee.' })
  @IsIn(VERIFY_DECISIONS, { message: 'Quyết định phải là APPROVED hoặc REJECTED.' })
  decision: VerifyDecision;

  @ApiPropertyOptional({ minLength: 5, maxLength: 200, description: 'Required when REJECTED (5-200 characters): shown to the assignee so they know what to fix.' })
  @ValidateIf((o: VerifyAssignmentDto) => o.decision === 'REJECTED')
  @Transform(trim)
  @IsString({ message: 'Hãy nhập lý do từ chối.' })
  @Length(5, 200, { message: 'Lý do từ chối cần từ 5 đến 200 ký tự.' })
  reason?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Length, ValidateIf } from 'class-validator';

export const VERIFY_DECISIONS = ['APPROVE', 'REJECT'] as const;
export type VerifyDecision = (typeof VERIFY_DECISIONS)[number];

export class VerifyAssignmentDto {
  @ApiProperty({ enum: VERIFY_DECISIONS })
  @IsIn(VERIFY_DECISIONS, { message: 'Quyết định phải là APPROVE hoặc REJECT.' })
  decision: VerifyDecision;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Bắt buộc khi REJECT, hiện cho người làm biết cần sửa gì',
  })
  @ValidateIf((o: VerifyAssignmentDto) => o.decision === 'REJECT')
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Hãy nhập lý do từ chối.' })
  @Length(1, 200, { message: 'Lý do từ chối cần từ 1 đến 200 ký tự.' })
  reason?: string;
}

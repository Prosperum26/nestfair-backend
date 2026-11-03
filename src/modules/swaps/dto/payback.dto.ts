import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class PaybackBodyDto {
  @ApiProperty({ format: 'uuid', description: 'Ca của bạn (người được làm bù) sẽ chuyển cho người nợ' })
  @IsUUID(undefined, { message: 'Hãy chọn một ca.' })
  assignmentId: string;
}

export class PaybackOptionDto {
  @ApiProperty({ format: 'uuid' }) assignmentId: string;
  @ApiProperty() choreTitle: string;
  @ApiProperty({ example: '2026-10-30' }) occurrenceDate: string;
  @ApiProperty() dueAt: Date;
  @ApiProperty({ minimum: 1, maximum: 5 }) weight: number;
  @ApiProperty({ description: 'weight của ca − weight còn nợ; dùng dấu + / − (U+2212) khi hiển thị' }) weightDiff: number;
  @ApiProperty() valid: boolean;
  @ApiPropertyOptional() reasonCode?: string;
  @ApiPropertyOptional({ description: 'Câu tiếng Việt hiển thị' }) reasonText?: string;
}

export class PaybackOptionsDto {
  @ApiProperty({ format: 'uuid' }) debtId: string;
  @ApiProperty() weight: number;
  @ApiProperty({ type: Date, nullable: true }) pickOpensAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) pickDeadlineAt: Date | null;
  @ApiProperty({ type: [PaybackOptionDto] }) options: PaybackOptionDto[];
}

export class PaybackResultDto {
  @ApiProperty({ format: 'uuid' }) debtId: string;
  @ApiProperty({ format: 'uuid' }) paybackAssignmentId: string;
  @ApiProperty({ description: 'true khi gọi lặp với cùng ca đã chọn' }) alreadyDone: boolean;
}

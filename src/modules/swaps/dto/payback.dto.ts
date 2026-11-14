import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class PaybackBodyDto {
  @ApiProperty({ format: 'uuid', description: 'Id of one of your own upcoming assignments. It will be handed to the debtor, who must do it as the payback.' })
  @IsUUID(undefined, { message: 'Hãy chọn một ca.' })
  assignmentId: string;
}

export class PaybackOptionDto {
  @ApiProperty({ format: 'uuid', description: 'Assignment id.' })
  assignmentId: string;

  @ApiProperty({ description: 'Chore name.' })
  choreTitle: string;

  @ApiProperty({ example: '2026-10-30', description: 'Day of the assignment (YYYY-MM-DD).' })
  occurrenceDate: string;

  @ApiProperty({ description: 'Deadline (ISO 8601 UTC).' })
  dueAt: Date;

  @ApiProperty({ minimum: 1, maximum: 5, description: 'Chore weight.' })
  weight: number;

  @ApiProperty({ description: 'The assignment weight minus the weight still owed; positive means you hand over more work than you are owed.' })
  weightDiff: number;

  @ApiProperty({ description: 'true when this assignment can be chosen as the payback.' })
  valid: boolean;

  @ApiPropertyOptional({ description: 'Swap error code explaining why it cannot be chosen, for example `PAYBACK_TOO_SOON` or `TARGET_ABSENT`.' })
  reasonCode?: string;

  @ApiPropertyOptional({ description: 'Localized (Vietnamese) sentence for the UI.' })
  reasonText?: string;
}

export class PaybackOptionsDto {
  @ApiProperty({ format: 'uuid', description: 'Debt id.' })
  debtId: string;

  @ApiProperty({ description: 'Weight still owed.' })
  weight: number;

  @ApiProperty({ type: Date, nullable: true, description: 'When the creditor may start choosing (ISO 8601 UTC).' })
  pickOpensAt: Date | null;

  @ApiProperty({ type: Date, nullable: true, description: 'Deadline for choosing; afterwards the system picks automatically.' })
  pickDeadlineAt: Date | null;

  @ApiProperty({ type: [PaybackOptionDto], description: 'The creditor\'s upcoming assignments, valid or not.' })
  options: PaybackOptionDto[];
}

export class PaybackResultDto {
  @ApiProperty({ format: 'uuid', description: 'Debt id.' })
  debtId: string;

  @ApiProperty({ format: 'uuid', description: 'The assignment now handed to the debtor.' })
  paybackAssignmentId: string;

  @ApiProperty({ description: 'true when this was a repeat of an earlier identical choice and nothing new happened.' })
  alreadyDone: boolean;
}

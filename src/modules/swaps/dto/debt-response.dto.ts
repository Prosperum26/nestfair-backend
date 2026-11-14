import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AssignmentStatus, DebtStatus } from '../../../generated/prisma/enums.js';

export const DEBT_PHASES = ['WAITING_COVER', 'WAITING_SCHEDULE', 'PICK_WINDOW', 'PAYBACK_ASSIGNED'] as const;
export type DebtPhase = (typeof DEBT_PHASES)[number];

export const DEBT_SCOPES = ['mine', 'all'] as const;
export type DebtScope = (typeof DEBT_SCOPES)[number];

export class ListDebtsQuery {
  @ApiProperty({ enum: DEBT_SCOPES, description: '`mine` = debts where you are the debtor or the creditor; `all` = every debt in the house.' })
  @IsIn(DEBT_SCOPES, { message: 'Phạm vi không hợp lệ.' })
  scope: DebtScope;
}

export class DebtCoverDto {
  @ApiProperty({ format: 'uuid', description: 'Id of the assignment that was covered.' })
  id: string;

  @ApiProperty({ description: 'Chore name.' })
  choreTitle: string;

  @ApiProperty({ example: '2026-10-25', description: 'Day of the covered assignment (YYYY-MM-DD).' })
  occurrenceDate: string;

  @ApiProperty({ enum: AssignmentStatus, enumName: 'AssignmentStatus', description: 'Current status of the covered assignment.' })
  status: AssignmentStatus;
}

export class DebtDto {
  @ApiProperty({ format: 'uuid', description: 'Debt id.' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'House-member id of the debtor: the person whose chore was covered and who now owes a chore.' })
  debtorMemberId: string;

  @ApiProperty({ description: 'Display name of the debtor.' })
  debtorName: string;

  @ApiProperty({ format: 'uuid', description: 'House-member id of the creditor: the person who covered the chore and is owed a payback.' })
  creditorMemberId: string;

  @ApiProperty({ description: 'Display name of the creditor.' })
  creditorName: string;

  @ApiProperty({ minimum: 1, description: 'Remaining chore weight owed (a count of effort, not money).' })
  weight: number;

  @ApiProperty({ enum: DebtStatus, enumName: 'DebtStatus', description: 'OPEN while owed, then a closed status.' })
  status: DebtStatus;

  @ApiProperty({ type: String, nullable: true, description: 'Why the debt was closed, for example OFFSET, STALE, FORGIVEN_BY_CREDITOR, COVER_MISSED, ADMIN_REASSIGN or ABSENT_REASSIGN; null while OPEN.' })
  closeReason: string | null;

  @ApiProperty({ type: Date, nullable: true, description: 'When the debt was closed (ISO 8601 UTC); null while OPEN.' })
  settledAt: Date | null;

  @ApiProperty({ enum: DEBT_PHASES, description: 'Where an OPEN debt stands: WAITING_COVER (the covered chore is not done yet), WAITING_SCHEDULE (waiting for next week\'s schedule), PICK_WINDOW (the creditor may choose a payback assignment) or PAYBACK_ASSIGNED (a payback assignment was chosen).' })
  phase: DebtPhase;

  @ApiProperty({ type: DebtCoverDto, nullable: true, description: 'The covered assignment that created the debt.' })
  coverAssignment: DebtCoverDto | null;

  @ApiProperty({ type: Date, nullable: true, description: 'When the creditor may start choosing (ISO 8601 UTC).' })
  pickOpensAt: Date | null;

  @ApiProperty({ type: Date, nullable: true, description: 'Deadline for choosing; afterwards the system picks automatically.' })
  pickDeadlineAt: Date | null;

  @ApiProperty({ description: 'How many times a payback choice has been attempted.' })
  pickAttempts: number;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'The assignment chosen as payback, once one is chosen.' })
  paybackAssignmentId: string | null;

  @ApiProperty({ description: 'When the debt was created (ISO 8601 UTC).' })
  createdAt: Date;
}

export class DebtGroupDto {
  @ApiProperty({ format: 'uuid', description: 'House-member id of the debtor.' })
  debtorMemberId: string;

  @ApiProperty({ description: 'Display name of the debtor.' })
  debtorName: string;

  @ApiProperty({ format: 'uuid', description: 'House-member id of the creditor.' })
  creditorMemberId: string;

  @ApiProperty({ description: 'Display name of the creditor.' })
  creditorName: string;

  @ApiProperty({ minimum: 0, description: 'Total weight of the OPEN debts in this group (units of chore effort, not VND).' })
  openWeight: number;

  @ApiProperty({ type: [DebtDto], description: 'OPEN debts first, then by creation time and id; includes debts closed within the last 30 days.' })
  debts: DebtDto[];
}

export class DebtGroupsResponseDto {
  @ApiProperty({ type: [DebtGroupDto], description: 'Debts grouped by (debtor, creditor) pair, the group with the oldest debt first. At most 100 groups.' })
  groups: DebtGroupDto[];

  @ApiProperty({ description: 'true when groups were dropped because of the 100-group limit (no group is ever cut in half).' })
  truncated: boolean;
}

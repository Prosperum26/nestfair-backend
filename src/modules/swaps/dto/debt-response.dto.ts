import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AssignmentStatus, DebtStatus } from '../../../generated/prisma/enums.js';

export const DEBT_PHASES = ['WAITING_COVER', 'WAITING_SCHEDULE', 'PICK_WINDOW', 'PAYBACK_ASSIGNED'] as const;
export type DebtPhase = (typeof DEBT_PHASES)[number];

export const DEBT_SCOPES = ['mine', 'all'] as const;
export type DebtScope = (typeof DEBT_SCOPES)[number];

export class ListDebtsQuery {
  @ApiProperty({ enum: DEBT_SCOPES })
  @IsIn(DEBT_SCOPES, { message: 'Phạm vi không hợp lệ.' })
  scope: DebtScope;
}

export class DebtCoverDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() choreTitle: string;
  @ApiProperty({ example: '2026-10-25' }) occurrenceDate: string;
  @ApiProperty({ enum: AssignmentStatus, enumName: 'AssignmentStatus' }) status: AssignmentStatus;
}

export class DebtDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid', description: 'HouseMember.id người được làm hộ, đang nợ ca' }) debtorMemberId: string;
  @ApiProperty() debtorName: string;
  @ApiProperty({ format: 'uuid', description: 'HouseMember.id người đã làm hộ, được làm bù' }) creditorMemberId: string;
  @ApiProperty() creditorName: string;
  @ApiProperty({ minimum: 1, description: 'Độ nặng còn nợ' }) weight: number;
  @ApiProperty({ enum: DebtStatus, enumName: 'DebtStatus' }) status: DebtStatus;
  @ApiProperty({ enum: DEBT_PHASES, description: 'Chờ ca gốc xong / chờ lịch tuần sau / đang trong cửa sổ chọn bù / đã chọn ca bù' }) phase: DebtPhase;
  @ApiProperty({ type: DebtCoverDto, nullable: true }) coverAssignment: DebtCoverDto | null;
  @ApiProperty({ type: Date, nullable: true }) pickOpensAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) pickDeadlineAt: Date | null;
  @ApiProperty() pickAttempts: number;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) paybackAssignmentId: string | null;
  @ApiProperty() createdAt: Date;
}

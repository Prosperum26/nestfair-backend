import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Compensation, SwapResolution, SwapStatus, SwapType } from '../../../generated/prisma/enums.js';

export class SwapSlotDto {
  @ApiProperty({ format: 'uuid', description: 'Assignment id.' })
  id: string;

  @ApiProperty({ description: 'Chore name.' })
  choreTitle: string;

  @ApiProperty({ example: '2026-10-22', description: 'Day of the assignment (YYYY-MM-DD).' })
  occurrenceDate: string;

  @ApiProperty({ description: 'Deadline (ISO 8601 UTC).' })
  dueAt: Date;

  @ApiProperty({ minimum: 1, maximum: 5, description: 'Chore weight.' })
  weight: number;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'House-member id of the current holder of the assignment.' })
  assigneeId: string | null;
}

export class EligibilityDto {
  @ApiProperty({ description: 'true when the viewer may accept this market request.' })
  canAccept: boolean;

  @ApiPropertyOptional({ description: 'Swap error code explaining why not, when `canAccept` is false.' })
  reasonCode?: string;

  @ApiPropertyOptional({ description: 'Localized (Vietnamese) sentence for the UI.' })
  reasonText?: string;
}

export class SwapSummaryDto {
  @ApiProperty({ description: 'Pending requests addressed to the caller.' })
  incoming: number;

  @ApiProperty({ description: 'Open market requests the caller could accept.' })
  market: number;

  @ApiProperty({ description: 'Open chore debts the caller owes to others.' })
  debtsOwedByMe: number;

  @ApiProperty({ description: 'Open chore debts others owe to the caller.' })
  debtsOwedToMe: number;
}

export class SwapDto {
  @ApiProperty({ format: 'uuid', description: 'Swap request id.' })
  id: string;

  @ApiProperty({ enum: SwapType, enumName: 'SwapType', description: 'EXCHANGE, COVER or PERMANENT.' })
  type: SwapType;

  @ApiProperty({ enum: SwapStatus, enumName: 'SwapStatus', description: 'PENDING while waiting for an answer, then ACCEPTED, REJECTED, CANCELLED or EXPIRED.' })
  status: SwapStatus;

  @ApiProperty({ enum: SwapResolution, enumName: 'SwapResolution', nullable: true, description: 'How a finished request ended (for example ESCALATED or EXPIRED_NO_TAKER); null while pending.' })
  resolution: SwapResolution | null;

  @ApiProperty({ format: 'uuid', description: 'House-member id of the person who made the request.' })
  requesterMemberId: string;

  @ApiProperty({ description: 'Display name of the requester.' })
  requesterName: string;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'House-member id of the named target; null for a market request.' })
  targetMemberId: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Display name of the target, or null.' })
  targetName: string | null;

  @ApiProperty({ type: SwapSlotDto, nullable: true, description: 'The requester\'s assignment being given away.' })
  fromAssignment: SwapSlotDto | null;

  @ApiProperty({ type: SwapSlotDto, nullable: true, description: 'EXCHANGE: the assignment requested in return; null otherwise.' })
  toAssignment: SwapSlotDto | null;

  @ApiProperty({ enum: Compensation, enumName: 'Compensation', nullable: true, description: 'COVER: PAYBACK or GIFT; null for other types.' })
  compensation: Compensation | null;

  @ApiProperty({ type: String, nullable: true, description: 'Gift description, when the compensation is GIFT.' })
  rewardNote: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Gift value in integer VND, when the compensation is GIFT.' })
  rewardAmount: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'Private reason; returned only to the requester, the target and the admin.' })
  reason: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Message to the target; returned only to the requester, the target and the admin.' })
  note: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Reason given when the target rejected; returned only to the requester, the target and the admin.' })
  rejectReason: string | null;

  @ApiProperty({ description: 'When the request expires (ISO 8601 UTC): the earlier of 24 hours after creation and 6 hours before the assignment deadline.' })
  expiresAt: Date;

  @ApiProperty({ description: 'When the request was created (ISO 8601 UTC).' })
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true, description: 'When it was accepted (ISO 8601 UTC), or null.' })
  acceptedAt: Date | null;

  @ApiProperty({ format: 'uuid', description: 'Id of the first request in a chain of reposts; equals `id` for an original request.' })
  rootRequestId: string;

  @ApiProperty({ description: 'true when the request is posted on the market (no named target).' })
  market: boolean;

  @ApiPropertyOptional({ type: EligibilityDto, description: 'Present only for scope MARKET: whether the viewer can accept it.' })
  eligibility?: EligibilityDto;
}

export class AcceptSwapResultDto {
  @ApiProperty({ type: SwapDto, description: 'The accepted request.' })
  swap: SwapDto;

  @ApiProperty({ description: 'true when this was a repeated call with the same Idempotency-Key and nothing new happened.' })
  alreadyDone: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Compensation, SwapResolution, SwapStatus, SwapType } from '../../../generated/prisma/enums.js';

export class SwapSlotDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() choreTitle: string;
  @ApiProperty({ example: '2026-10-22' }) occurrenceDate: string;
  @ApiProperty() dueAt: Date;
  @ApiProperty({ minimum: 1, maximum: 5 }) weight: number;
  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'HouseMember.id đang giữ ca' }) assigneeId: string | null;
}

export class EligibilityDto {
  @ApiProperty() canAccept: boolean;
  @ApiPropertyOptional() reasonCode?: string;
  @ApiPropertyOptional({ description: 'Câu tiếng Việt hiển thị' }) reasonText?: string;
}

export class SwapSummaryDto {
  @ApiProperty() incoming: number;
  @ApiProperty() market: number;
  @ApiProperty() debtsOwedByMe: number;
  @ApiProperty() debtsOwedToMe: number;
}

export class SwapDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: SwapType, enumName: 'SwapType' }) type: SwapType;
  @ApiProperty({ enum: SwapStatus, enumName: 'SwapStatus' }) status: SwapStatus;
  @ApiProperty({ enum: SwapResolution, enumName: 'SwapResolution', nullable: true }) resolution: SwapResolution | null;
  @ApiProperty({ format: 'uuid', description: 'HouseMember.id' }) requesterMemberId: string;
  @ApiProperty() requesterName: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'HouseMember.id; null = Chợ ca' }) targetMemberId: string | null;
  @ApiProperty({ type: String, nullable: true }) targetName: string | null;
  @ApiProperty({ type: SwapSlotDto, nullable: true }) fromAssignment: SwapSlotDto | null;
  @ApiProperty({ type: SwapSlotDto, nullable: true }) toAssignment: SwapSlotDto | null;
  @ApiProperty({ enum: Compensation, enumName: 'Compensation', nullable: true }) compensation: Compensation | null;
  @ApiProperty({ type: String, nullable: true }) rewardNote: string | null;
  @ApiProperty({ type: Number, nullable: true }) rewardAmount: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'Chỉ người gửi, người nhận và trưởng phòng thấy' }) reason: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Chỉ người gửi, người nhận và trưởng phòng thấy' }) note: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Chỉ người gửi, người nhận và trưởng phòng thấy' }) rejectReason: string | null;
  @ApiProperty() expiresAt: Date;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: Date, nullable: true }) acceptedAt: Date | null;
  @ApiProperty({ format: 'uuid' }) rootRequestId: string;
  @ApiProperty({ description: 'true = đăng lên Chợ ca (không có người nhận đích danh)' }) market: boolean;
  @ApiPropertyOptional({ type: EligibilityDto, description: 'Chỉ có ở scope MARKET: người xem có nhận giúp được không' }) eligibility?: EligibilityDto;
}

export class AcceptSwapResultDto {
  @ApiProperty({ type: SwapDto }) swap: SwapDto;
  @ApiProperty({ description: 'true khi đây là lần gọi lặp với cùng Idempotency-Key' }) alreadyDone: boolean;
}

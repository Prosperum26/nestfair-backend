import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AdjustmentKind, HouseRole } from '../../../generated/prisma/enums.js';

/** Ca tương lai của người rời nhà: hệ thống tự chia (S-18) hay để trống cho trưởng phòng gán. */
export const SHIFT_MODES = ['AUTO', 'MANUAL'] as const;
export type ShiftMode = (typeof SHIFT_MODES)[number];

export class LeaveHouseDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Required when the admin leaves a house that still has other members: the user id of the member who becomes the new admin.' })
  @IsOptional()
  @IsUUID('all', { message: 'Người nhận quyền không hợp lệ.' })
  newAdminUserId?: string;
}

export class KickMemberDto {
  @ApiPropertyOptional({
    enum: AdjustmentKind,
    enumName: 'AdjustmentKind',
    description: 'Required when the removed member has a non-zero balance. `WRITE_OFF` forgives the balance (it disappears from the ledger); `TRANSFER` moves it to the member given in `toUserId`.',
  })
  @IsOptional()
  @IsEnum(AdjustmentKind, { message: 'Cách xử lý số dư không hợp lệ.' })
  mode?: AdjustmentKind;

  @ApiPropertyOptional({ format: 'uuid', description: 'With `mode: TRANSFER`: the active member who takes over the removed member\'s balance.' })
  @IsOptional()
  @IsUUID('all', { message: 'Người nhận không hợp lệ.' })
  toUserId?: string;

  @ApiPropertyOptional({ enum: SHIFT_MODES, default: 'AUTO', description: 'What happens to the removed member\'s upcoming chore assignments: `AUTO` redistributes them fairly among the others, `MANUAL` leaves them unassigned for the admin to assign.' })
  @IsOptional()
  @IsIn(SHIFT_MODES, { message: 'Cách xử lý ca không hợp lệ.' })
  shifts?: ShiftMode;
}

export class TransferAdminDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the active member who becomes the admin. The caller becomes a regular roommate.' })
  @IsUUID('all', { message: 'Người nhận quyền không hợp lệ.' })
  userId: string;
}

export class LeavePreviewDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the member being previewed.' })
  userId: string;

  @ApiProperty({ description: 'Member display name.' })
  fullName: string;

  @ApiProperty({ enum: HouseRole, enumName: 'HouseRole', description: 'The member\'s role.' })
  role: HouseRole;

  @ApiProperty({ description: 'Net balance in integer VND: positive = the member is owed money, negative = the member owes money.' })
  net: number;

  @ApiProperty({ description: 'Number of pending payment reports involving this member (they are cancelled when the member leaves).' })
  pendingSettlements: number;

  @ApiProperty({ description: 'Number of open chore debts involving this member (closed on leaving; shown as a warning only).' })
  openChoreDebts: number;

  @ApiProperty({ description: 'Number of upcoming TODO chore assignments of this member.' })
  futureShifts: number;

  @ApiProperty({ description: 'true when this is the last active member, who cannot leave (dissolve the house instead).' })
  isLastMember: boolean;
}

class AdjustmentSummaryDto {
  @ApiProperty({ enum: AdjustmentKind, enumName: 'AdjustmentKind', description: 'WRITE_OFF or TRANSFER.' })
  kind: AdjustmentKind;

  @ApiProperty({ description: 'The balance that was settled, in integer VND (positive = was owed to the member, negative = was owed by the member).' })
  amount: number;

  @ApiProperty({ nullable: true, type: String, format: 'uuid', description: 'For TRANSFER: the user who took over the balance; null for WRITE_OFF.' })
  toUserId: string | null;
}

export class RemoveMemberResultDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the member who left or was removed.' })
  userId: string;

  @ApiProperty({ type: AdjustmentSummaryDto, nullable: true, description: 'How a non-zero balance was handled; null when the balance was already zero.' })
  adjustment: AdjustmentSummaryDto | null;

  @ApiProperty({ enum: SHIFT_MODES, description: 'How the upcoming chore assignments were handled.' })
  shifts: ShiftMode;

  @ApiProperty({ description: 'Number of upcoming assignments the member had when leaving.' })
  futureShifts: number;
}

export class TransferAdminResultDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the new admin.' })
  adminUserId: string;
}

export class DissolveHouseDto {
  @ApiProperty({ maxLength: 120, example: 'Sunrise House', description: 'The exact house name, retyped to confirm (case-sensitive, surrounding spaces ignored).' })
  @IsString({ message: 'Hãy gõ tên nhà để xác nhận.' })
  @IsNotEmpty({ message: 'Hãy gõ tên nhà để xác nhận.' })
  @MaxLength(120)
  confirmName: string;
}

export class DissolveHouseResultDto {
  @ApiProperty({ format: 'uuid', description: 'Id of the dissolved house.' })
  houseId: string;

  @ApiProperty({ description: 'Number of members who were removed from the house.' })
  members: number;

  @ApiProperty({ description: 'Number of Cloudinary images deleted (chore proofs, receipts, payment proofs, scans, listing photos).' })
  imagesRemoved: number;
}

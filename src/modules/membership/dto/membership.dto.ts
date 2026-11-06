import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AdjustmentKind, HouseRole } from '../../../generated/prisma/enums.js';

/** Ca tương lai của người rời nhà: hệ thống tự chia (S-18) hay để trống cho trưởng phòng gán. */
export const SHIFT_MODES = ['AUTO', 'MANUAL'] as const;
export type ShiftMode = (typeof SHIFT_MODES)[number];

export class LeaveHouseDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Bắt buộc khi trưởng phòng rời nhà còn người: người nhận quyền trưởng phòng' })
  @IsOptional()
  @IsUUID('all', { message: 'Người nhận quyền không hợp lệ.' })
  newAdminUserId?: string;
}

export class KickMemberDto {
  @ApiPropertyOptional({
    enum: AdjustmentKind,
    description: 'Bắt buộc khi người bị xóa còn số dư khác 0. WRITE_OFF: xóa khoản đó · TRANSFER: chuyển cho toUserId',
  })
  @IsOptional()
  @IsEnum(AdjustmentKind, { message: 'Cách xử lý số dư không hợp lệ.' })
  mode?: AdjustmentKind;

  @ApiPropertyOptional({ format: 'uuid', description: 'TRANSFER: thành viên nhận phần số dư' })
  @IsOptional()
  @IsUUID('all', { message: 'Người nhận không hợp lệ.' })
  toUserId?: string;

  @ApiPropertyOptional({ enum: SHIFT_MODES, default: 'AUTO', description: 'Ca sắp tới của người bị xóa: AUTO tự chia · MANUAL để trống cho trưởng phòng gán' })
  @IsOptional()
  @IsIn(SHIFT_MODES, { message: 'Cách xử lý ca không hợp lệ.' })
  shifts?: ShiftMode;
}

export class TransferAdminDto {
  @ApiProperty({ format: 'uuid', description: 'Thành viên nhận quyền trưởng phòng' })
  @IsUUID('all', { message: 'Người nhận quyền không hợp lệ.' })
  userId: string;
}

export class LeavePreviewDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ enum: HouseRole }) role: HouseRole;
  @ApiProperty({ description: 'Số dư ròng, VNĐ nguyên: dương = được nhận, âm = cần trả' }) net: number;
  @ApiProperty({ description: 'Yêu cầu thanh toán đang chờ có người này (sẽ bị hủy khi xóa)' }) pendingSettlements: number;
  @ApiProperty({ description: 'Nợ ca còn OPEN có người này (sẽ đóng, chỉ cảnh báo)' }) openChoreDebts: number;
  @ApiProperty({ description: 'Ca TODO sắp tới của người này' }) futureShifts: number;
  @ApiProperty({ description: 'Người cuối cùng trong nhà (không rời được)' }) isLastMember: boolean;
}

class AdjustmentSummaryDto {
  @ApiProperty({ enum: AdjustmentKind }) kind: AdjustmentKind;
  @ApiProperty({ description: 'Số dư đã xử lý (dương = được nhận, âm = cần trả)' }) amount: number;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' }) toUserId: string | null;
}

export class RemoveMemberResultDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ type: AdjustmentSummaryDto, nullable: true }) adjustment: AdjustmentSummaryDto | null;
  @ApiProperty({ enum: SHIFT_MODES }) shifts: ShiftMode;
  @ApiProperty({ description: 'Số ca sắp tới của người đó lúc rời' }) futureShifts: number;
}

export class TransferAdminResultDto {
  @ApiProperty({ format: 'uuid' }) adminUserId: string;
}

export class DissolveHouseDto {
  @ApiProperty({ description: 'Gõ lại đúng tên nhà để xác nhận giải tán' })
  @IsString({ message: 'Hãy gõ tên nhà để xác nhận.' })
  @IsNotEmpty({ message: 'Hãy gõ tên nhà để xác nhận.' })
  @MaxLength(120)
  confirmName: string;
}

export class DissolveHouseResultDto {
  @ApiProperty({ format: 'uuid' }) houseId: string;
  @ApiProperty({ description: 'Số thành viên đã được cho rời nhà' }) members: number;
  @ApiProperty({ description: 'Số ảnh Cloudinary đã dọn (ảnh minh chứng, hóa đơn, tin đăng)' }) imagesRemoved: number;
}

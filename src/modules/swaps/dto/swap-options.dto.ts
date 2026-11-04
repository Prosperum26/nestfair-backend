import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Compensation } from '../../../generated/prisma/enums.js';

export const OPTION_TYPES = ['EXCHANGE', 'COVER'] as const;
export type OptionType = (typeof OPTION_TYPES)[number];

export class SwapOptionsQuery {
  @ApiProperty({ enum: OPTION_TYPES })
  @IsIn(OPTION_TYPES, { message: 'Loại đổi ca không hợp lệ.' })
  type: OptionType;

  @ApiPropertyOptional({ enum: Compensation, enumName: 'Compensation', description: 'Chỉ cho COVER; mặc định GIFT (hợp lệ với mọi loại ca)' })
  @IsOptional()
  @IsIn(Object.values(Compensation), { message: 'Hình thức đền đáp không hợp lệ.' })
  compensation?: Compensation;
}

export class SwapOptionDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'EXCHANGE: ca đích' }) assignmentId?: string;
  @ApiProperty({ format: 'uuid', description: 'HouseMember.id của người nhận / chủ ca đích' }) memberId: string;
  @ApiProperty() memberName: string;
  @ApiPropertyOptional() choreTitle?: string;
  @ApiPropertyOptional({ example: '2026-10-22' }) occurrenceDate?: string;
  @ApiPropertyOptional() dueAt?: Date;
  @ApiPropertyOptional({ minimum: 1, maximum: 5 }) weight?: number;
  @ApiProperty() valid: boolean;
  @ApiPropertyOptional({ description: 'Mã lỗi chuẩn (mục 9.3), có khi valid = false' }) reasonCode?: string;
  @ApiPropertyOptional({ description: 'Chi tiết của SLOT_NOT_SWAPPABLE: PENDING_VERIFY, IN_GRACE…' }) detailCode?: string;
  @ApiPropertyOptional({ description: 'Câu tiếng Việt hiển thị cho người dùng' }) reasonText?: string;
  @ApiProperty({ type: [String], description: 'Cảnh báo mềm cần tick xác nhận (acknowledgedWarnings)' }) warnings: string[];
}

export class SwapMarketDto {
  @ApiProperty() allowed: boolean;
  @ApiProperty({ type: String, nullable: true }) reasonText: string | null;
}

export class SwapOptionsDto {
  @ApiProperty({ enum: OPTION_TYPES }) type: OptionType;
  @ApiProperty({ type: [SwapOptionDto] }) options: SwapOptionDto[];
  @ApiProperty({ type: SwapMarketDto }) market: SwapMarketDto;
}

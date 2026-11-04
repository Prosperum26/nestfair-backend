import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Compensation } from '../../../generated/prisma/enums.js';

export const CREATE_SWAP_TYPES = ['EXCHANGE', 'COVER'] as const;
export type CreateSwapType = (typeof CREATE_SWAP_TYPES)[number];

export const WARNING_CODES = ['WEIGHT_GAP', 'FENCE_REPEAT', 'OVER_DAILY_CAP', 'CONSECUTIVE_DAY', 'DUE_SOON'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateSwapDto {
  @ApiProperty({ enum: CREATE_SWAP_TYPES })
  @IsIn(CREATE_SWAP_TYPES, { message: 'Loại đổi ca không hợp lệ.' })
  type: CreateSwapType;

  @ApiProperty({ format: 'uuid', description: 'Ca của bạn' })
  @IsUUID(undefined, { message: 'Hãy chọn ca của bạn.' })
  fromAssignmentId: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'EXCHANGE: ca bạn muốn đổi lấy (bắt buộc)' })
  @ValidateIf((o: CreateSwapDto) => o.type === 'EXCHANGE')
  @IsUUID(undefined, { message: 'Hãy chọn ca muốn đổi.' })
  toAssignmentId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'COVER: HouseMember.id người được nhờ. Bỏ trống = đăng lên Chợ ca' })
  @IsOptional()
  @IsUUID(undefined, { message: 'Người được nhờ không hợp lệ.' })
  targetMemberId?: string;

  @ApiPropertyOptional({ enum: Compensation, enumName: 'Compensation', description: 'COVER: bắt buộc' })
  @ValidateIf((o: CreateSwapDto) => o.type === 'COVER')
  @IsIn(Object.values(Compensation), { message: 'Hãy chọn cách đền đáp: làm bù hoặc quà.' })
  compensation?: Compensation;

  @ApiPropertyOptional({ maxLength: 100, description: 'Ghi chú quà (chỉ khi GIFT)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100, { message: 'Ghi chú quà tối đa 100 ký tự.' })
  rewardNote?: string;

  @ApiPropertyOptional({ description: 'VNĐ, 1.000–500.000, bước 1.000, chỉ khi GIFT' })
  @IsOptional()
  @IsInt({ message: 'Quà từ 1.000đ đến 500.000đ.' })
  rewardAmount?: number;

  @ApiPropertyOptional({ maxLength: 200, description: 'Lý do riêng tư: chỉ người gửi, người nhận và trưởng phòng thấy' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Lời nhắn gửi người nhận đích danh' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Lời nhắn tối đa 200 ký tự.' })
  note?: string;

  @ApiPropertyOptional({ enum: WARNING_CODES, isArray: true, description: 'Các cảnh báo mềm bạn đã đọc và xác nhận' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WARNING_CODES.length)
  @IsIn(WARNING_CODES, { each: true, message: 'Mã cảnh báo không hợp lệ.' })
  acknowledgedWarnings?: string[];
}

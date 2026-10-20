import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const CREATE_SWAP_TYPES = ['EXCHANGE'] as const;
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

  @ApiProperty({ format: 'uuid', description: 'Ca bạn muốn đổi lấy' })
  @IsUUID(undefined, { message: 'Hãy chọn ca muốn đổi.' })
  toAssignmentId: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Lý do riêng tư: chỉ người gửi, người nhận và trưởng phòng thấy' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Lời nhắn gửi người nhận' })
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

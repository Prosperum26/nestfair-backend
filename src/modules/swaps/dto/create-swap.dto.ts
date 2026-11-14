import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Compensation } from '../../../generated/prisma/enums.js';

export const CREATE_SWAP_TYPES = ['EXCHANGE', 'COVER'] as const;
export type CreateSwapType = (typeof CREATE_SWAP_TYPES)[number];

export const WARNING_CODES = ['WEIGHT_GAP', 'FENCE_REPEAT', 'OVER_DAILY_CAP', 'CONSECUTIVE_DAY', 'DUE_SOON'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateSwapDto {
  @ApiProperty({ enum: CREATE_SWAP_TYPES, description: '`EXCHANGE` swaps your assignment for one of another member; `COVER` asks someone to do your assignment for you (a specific member, or the whole house through the market).' })
  @IsIn(CREATE_SWAP_TYPES, { message: 'Loại đổi ca không hợp lệ.' })
  type: CreateSwapType;

  @ApiProperty({ format: 'uuid', description: 'Id of your own assignment that you want to give away or swap. It must still be TODO, not overdue and not already locked by another pending request.' })
  @IsUUID(undefined, { message: 'Hãy chọn ca của bạn.' })
  fromAssignmentId: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'EXCHANGE only (required): id of the other member\'s assignment you want in return. Its owner becomes the target of the request.' })
  @ValidateIf((o: CreateSwapDto) => o.type === 'EXCHANGE')
  @IsUUID(undefined, { message: 'Hãy chọn ca muốn đổi.' })
  toAssignmentId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'COVER only: house-member id of the person you ask. Omit it to post the request on the market, where any member may accept.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'Người được nhờ không hợp lệ.' })
  targetMemberId?: string;

  @ApiPropertyOptional({ enum: Compensation, enumName: 'Compensation', description: 'COVER only (required): `PAYBACK` means the helper later receives one of your assignments in return (creates a chore debt); `GIFT` means you reward the helper with a gift.' })
  @ValidateIf((o: CreateSwapDto) => o.type === 'COVER')
  @IsIn(Object.values(Compensation), { message: 'Hãy chọn cách đền đáp: làm bù hoặc quà.' })
  compensation?: Compensation;

  @ApiPropertyOptional({ maxLength: 100, description: 'Free-text description of the gift, for example "a bubble tea" (GIFT only, up to 100 characters).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100, { message: 'Ghi chú quà tối đa 100 ký tự.' })
  rewardNote?: string;

  @ApiPropertyOptional({ minimum: 1000, maximum: 500000, multipleOf: 1000, description: 'Gift value in integer VND, from 1,000 to 500,000 in steps of 1,000 (GIFT only). When the request is accepted a GIFT expense is recorded from you to the helper.' })
  @IsOptional()
  @IsInt({ message: 'Quà từ 1.000đ đến 500.000đ.' })
  rewardAmount?: number;

  @ApiPropertyOptional({ maxLength: 200, description: 'Private reason (up to 200 characters), visible only to the requester, the target and the admin.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Lý do tối đa 200 ký tự.' })
  reason?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Message to the named target (up to 200 characters).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Lời nhắn tối đa 200 ký tự.' })
  note?: string;

  @ApiPropertyOptional({ enum: WARNING_CODES, isArray: true, description: 'Soft warnings the requester has read and confirmed. Every warning returned for the chosen option by the swap-options endpoint must be listed, otherwise the request is refused with `WARNINGS_NOT_ACKNOWLEDGED`. Values: WEIGHT_GAP, FENCE_REPEAT, OVER_DAILY_CAP, CONSECUTIVE_DAY, DUE_SOON.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WARNING_CODES.length)
  @IsIn(WARNING_CODES, { each: true, message: 'Mã cảnh báo không hợp lệ.' })
  acknowledgedWarnings?: string[];
}

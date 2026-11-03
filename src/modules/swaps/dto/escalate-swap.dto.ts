import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SwapDto } from './swap-response.dto.js';

export const ESCALATE_ACTIONS = ['ADD_REWARD', 'RESEND', 'SELF'] as const;
export type EscalateAction = (typeof ESCALATE_ACTIONS)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class EscalateSwapDto {
  @ApiProperty({ enum: ESCALATE_ACTIONS, description: 'ADD_REWARD: thêm quà và đăng lại Chợ ca. RESEND: gửi người khác. SELF: tự làm' })
  @IsIn(ESCALATE_ACTIONS, { message: 'Lựa chọn không hợp lệ.' })
  action: EscalateAction;

  @ApiPropertyOptional({ maxLength: 100, description: 'ADD_REWARD: ghi chú quà mới' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100, { message: 'Ghi chú quà tối đa 100 ký tự.' })
  rewardNote?: string;

  @ApiPropertyOptional({ description: 'ADD_REWARD: VNĐ, 1.000–500.000, bước 1.000, phải lớn hơn lần trước (hoặc đổi ghi chú)' })
  @IsOptional()
  @IsInt({ message: 'Quà từ 1.000đ đến 500.000đ.' })
  rewardAmount?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'RESEND: HouseMember.id người nhận mới. Bỏ trống = hệ thống chọn' })
  @IsOptional()
  @IsUUID(undefined, { message: 'Người nhận không hợp lệ.' })
  targetMemberId?: string;
}

export class EscalateResultDto {
  @ApiProperty({ type: SwapDto, description: 'Yêu cầu đã hết hạn vừa được xử lý' }) swap: SwapDto;
  @ApiPropertyOptional({ type: SwapDto, description: 'Yêu cầu mới (ADD_REWARD hoặc RESEND)' }) newSwap?: SwapDto;
}

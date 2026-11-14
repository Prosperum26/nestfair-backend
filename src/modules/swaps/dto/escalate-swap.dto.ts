import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SwapDto } from './swap-response.dto.js';

export const ESCALATE_ACTIONS = ['ADD_REWARD', 'RESEND', 'SELF'] as const;
export type EscalateAction = (typeof ESCALATE_ACTIONS)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class EscalateSwapDto {
  @ApiProperty({ enum: ESCALATE_ACTIONS, description: '`ADD_REWARD` adds or raises a gift and reposts the request on the market; `RESEND` sends it to another member; `SELF` gives up asking and keeps the assignment (the default if nothing is chosen).' })
  @IsIn(ESCALATE_ACTIONS, { message: 'Lựa chọn không hợp lệ.' })
  action: EscalateAction;

  @ApiPropertyOptional({ maxLength: 100, description: 'ADD_REWARD: new gift description (up to 100 characters).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100, { message: 'Ghi chú quà tối đa 100 ký tự.' })
  rewardNote?: string;

  @ApiPropertyOptional({ minimum: 1000, maximum: 500000, multipleOf: 1000, description: 'ADD_REWARD: new gift value in integer VND (1,000-500,000 in steps of 1,000). Must be higher than the previous attempt unless the note changes.' })
  @IsOptional()
  @IsInt({ message: 'Quà từ 1.000đ đến 500.000đ.' })
  rewardAmount?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'RESEND: house-member id of the new target. Omit to let the system choose a suitable member.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'Người nhận không hợp lệ.' })
  targetMemberId?: string;
}

export class EscalateResultDto {
  @ApiProperty({ type: SwapDto, description: 'The expired request that was just handled (its resolution records the choice).' })
  swap: SwapDto;

  @ApiPropertyOptional({ type: SwapDto, description: 'The new request created by ADD_REWARD or RESEND; absent for SELF.' })
  newSwap?: SwapDto;
}

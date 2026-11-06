import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Compensation } from '../../../generated/prisma/enums.js';

export const OPTION_TYPES = ['EXCHANGE', 'COVER'] as const;
export type OptionType = (typeof OPTION_TYPES)[number];

export class SwapOptionsQuery {
  @ApiProperty({ enum: OPTION_TYPES, description: '`EXCHANGE` lists assignments you could swap for; `COVER` lists members who could do your assignment.' })
  @IsIn(OPTION_TYPES, { message: 'Loại đổi ca không hợp lệ.' })
  type: OptionType;

  @ApiPropertyOptional({ enum: Compensation, enumName: 'Compensation', description: 'COVER only: `PAYBACK` or `GIFT`. Defaults to GIFT, which is valid for every kind of assignment.' })
  @IsOptional()
  @IsIn(Object.values(Compensation), { message: 'Hình thức đền đáp không hợp lệ.' })
  compensation?: Compensation;
}

export class SwapOptionDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'EXCHANGE: id of the target assignment.' })
  assignmentId?: string;

  @ApiProperty({ format: 'uuid', description: 'House-member id of the candidate (the person to ask, or the owner of the target assignment).' })
  memberId: string;

  @ApiProperty({ description: 'Display name of the candidate.' })
  memberName: string;

  @ApiPropertyOptional({ description: 'EXCHANGE: chore name of the target assignment.' })
  choreTitle?: string;

  @ApiPropertyOptional({ example: '2026-10-22', description: 'EXCHANGE: day of the target assignment (YYYY-MM-DD).' })
  occurrenceDate?: string;

  @ApiPropertyOptional({ description: 'EXCHANGE: deadline of the target assignment (ISO 8601 UTC).' })
  dueAt?: Date;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, description: 'EXCHANGE: weight of the target assignment.' })
  weight?: number;

  @ApiProperty({ description: 'true when this option can be chosen; false when a rule forbids it (see `reasonCode`).' })
  valid: boolean;

  @ApiPropertyOptional({ description: 'Swap error code explaining why the option is invalid, for example `FENCE_VIOLATION` or `TARGET_ABSENT` (see the error code catalogue).' })
  reasonCode?: string;

  @ApiPropertyOptional({ description: 'More detail for `SLOT_NOT_SWAPPABLE`, for example PENDING_VERIFY or IN_GRACE.' })
  detailCode?: string;

  @ApiPropertyOptional({ description: 'Localized (Vietnamese) sentence for the UI explaining why the option is invalid.' })
  reasonText?: string;

  @ApiProperty({ type: [String], description: 'Soft warnings the requester must acknowledge when choosing this option (WEIGHT_GAP, FENCE_REPEAT, OVER_DAILY_CAP, CONSECUTIVE_DAY, DUE_SOON).' })
  warnings: string[];
}

export class SwapMarketDto {
  @ApiProperty({ description: 'true when the assignment can be posted on the market.' })
  allowed: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'Localized reason when the market is not allowed, otherwise null.' })
  reasonText: string | null;
}

export class SwapOptionsDto {
  @ApiProperty({ enum: OPTION_TYPES, description: 'The type that was asked for.' })
  type: OptionType;

  @ApiProperty({ type: [SwapOptionDto], description: 'Candidates, valid and invalid, with the reason for each invalid one.' })
  options: SwapOptionDto[];

  @ApiProperty({ type: SwapMarketDto, description: 'Whether posting the assignment on the market is possible.' })
  market: SwapMarketDto;
}

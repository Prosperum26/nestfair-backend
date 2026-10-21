import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const SWAP_SCOPES = ['INCOMING', 'OUTGOING', 'MARKET'] as const;
export type SwapScope = (typeof SWAP_SCOPES)[number];

export class ListSwapsQuery {
  @ApiProperty({ enum: SWAP_SCOPES })
  @IsIn(SWAP_SCOPES, { message: 'Phạm vi không hợp lệ.' })
  scope: SwapScope;
}

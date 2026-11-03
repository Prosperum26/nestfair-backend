import { ApiProperty } from '@nestjs/swagger';
import { IsIn, Matches } from 'class-validator';

export const SWAP_SCOPES = ['INCOMING', 'OUTGOING', 'MARKET'] as const;
export type SwapScope = (typeof SWAP_SCOPES)[number];

export class ListSwapsQuery {
  @ApiProperty({ enum: SWAP_SCOPES })
  @IsIn(SWAP_SCOPES, { message: 'Phạm vi không hợp lệ.' })
  scope: SwapScope;
}

export class CancelPendingQuery {
  @ApiProperty({ example: '2026-W41' })
  @Matches(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/, { message: 'Tuần không hợp lệ, định dạng đúng là 2026-W41.' })
  week: string;
}

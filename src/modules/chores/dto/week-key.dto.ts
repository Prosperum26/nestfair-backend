import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

const WEEK_KEY = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const MESSAGE = 'Tuần không hợp lệ, định dạng đúng là 2026-W41.';

/** Query của GET /assignments. Mặc định tuần hiện tại. */
export class ListAssignmentsQuery {
  @ApiPropertyOptional({ example: '2026-W41' })
  @IsOptional()
  @Matches(WEEK_KEY, { message: MESSAGE })
  weekKey?: string;
}

/** Body của POST /assignments/shuffle. Mặc định tuần hiện tại. */
export class ShuffleAssignmentsDto {
  @ApiPropertyOptional({ example: '2026-W41' })
  @IsOptional()
  @Matches(WEEK_KEY, { message: MESSAGE })
  weekKey?: string;
}

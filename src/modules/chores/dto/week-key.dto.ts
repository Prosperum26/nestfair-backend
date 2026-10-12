import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

const WEEK_KEY = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const MESSAGE = 'Tuần không hợp lệ, định dạng đúng là 2026-W41.';

/** Query của GET /assignments. Mặc định tuần hiện tại. */
export class ListAssignmentsQuery {
  @ApiPropertyOptional({ example: '2026-W41' })
  @IsOptional()
  @Matches(WEEK_KEY, { message: MESSAGE })
  week?: string;
}

/** Body của POST /schedules/preview. */
export class PreviewScheduleDto {
  @ApiProperty({ example: '2026-W41' })
  @Matches(WEEK_KEY, { message: MESSAGE })
  weekKey: string;
}

export const SHUFFLE_MODES = ['CREATE', 'REROLL'] as const;

/** Body của POST /assignments/shuffle. */
export class ShuffleAssignmentsDto {
  @ApiProperty({ example: '2026-W41' })
  @Matches(WEEK_KEY, { message: MESSAGE })
  weekKey: string;

  @ApiProperty({ enum: SHUFFLE_MODES, description: 'CREATE: tạo lịch nếu chưa có (ai cũng được). REROLL: xáo lại, chỉ trưởng phòng.' })
  @IsIn(SHUFFLE_MODES, { message: 'Chế độ phải là CREATE hoặc REROLL.' })
  mode: (typeof SHUFFLE_MODES)[number];
}

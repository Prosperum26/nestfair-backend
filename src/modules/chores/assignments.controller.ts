import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { AssignmentsService } from './assignments.service.js';
import { PreviewResultDto, ShuffleResultDto, WeekViewDto } from './dto/assignment-response.dto.js';
import { ListAssignmentsQuery, PreviewScheduleDto, ShuffleAssignmentsDto } from './dto/week-key.dto.js';

@ApiTags('assignments')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này (hoặc không đủ quyền)' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get('assignments')
  @ApiOperation({
    summary: 'Lịch trực một tuần kèm scheduleMeta (mặc định tuần hiện tại). Chưa có lịch của tuần hiện tại/kế tiếp thì sinh bù.',
  })
  @ApiOkResponse({ type: WeekViewDto })
  @ApiBadRequestResponse({ description: 'week sai định dạng' })
  list(@CurrentMembership() m: HouseMembership, @Query() query: ListAssignmentsQuery): Promise<WeekViewDto> {
    return this.assignments.weekView(m.houseId, query.week);
  }

  @Post('schedules/preview')
  @ApiOperation({ summary: 'Xem trước lịch (dry-run, không lưu), kèm seed và lý do' })
  @ApiCreatedResponse({ type: PreviewResultDto })
  @ApiUnprocessableEntityResponse({ description: 'WEEK_OUT_OF_RANGE: chỉ tuần hiện tại hoặc kế tiếp' })
  preview(@CurrentMembership() m: HouseMembership, @Body() dto: PreviewScheduleDto): Promise<PreviewResultDto> {
    return this.assignments.preview(m.houseId, dto.weekKey);
  }

  @Post('assignments/shuffle')
  @ApiOperation({
    summary:
      'CREATE: tạo lịch tuần nếu chưa có (ai cũng được, trả lịch cũ nếu đã có). REROLL: xáo lại lịch đã có (chỉ trưởng phòng, ≤ 2 lần, trước khi tuần bắt đầu).',
  })
  @ApiCreatedResponse({ type: ShuffleResultDto })
  @ApiBadRequestResponse({ description: 'weekKey hoặc mode không hợp lệ' })
  @ApiConflictResponse({ description: 'SCHEDULE_LOCKED | SCHEDULE_HAS_ACTIVITY | REROLL_LIMIT' })
  @ApiUnprocessableEntityResponse({ description: 'WEEK_OUT_OF_RANGE' })
  shuffle(@CurrentMembership() m: HouseMembership, @Body() dto: ShuffleAssignmentsDto): Promise<ShuffleResultDto> {
    return this.assignments.shuffle(m.houseId, m, dto);
  }
}

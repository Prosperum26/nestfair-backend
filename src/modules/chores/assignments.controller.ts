import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { AssignmentsService } from './assignments.service.js';
import { PreviewResultDto, ShuffleResultDto, WeekViewDto } from './dto/assignment-response.dto.js';
import { ListAssignmentsQuery, PreviewScheduleDto, ShuffleAssignmentsDto } from './dto/week-key.dto.js';

@ApiTags('assignments')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house, or the action needs the admin role.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get('assignments')
  @ApiOperation({
    summary: 'Get the chore schedule of a week',
    description:
      'Returns every assignment of one ISO week together with the schedule metadata (fairness fence applied, whether it was ' +
      'relaxed, re-roll count, seed). Defaults to the current week. If the current or next week has no schedule yet, one is ' +
      'generated on demand with the fair-rotation algorithm (no one repeats the same chore within a 3-week window, total ' +
      'weight is balanced, ties are broken randomly). Past weeks are returned as stored.',
  })
  @ApiOkResponse({ type: WeekViewDto, description: 'The schedule and its assignments.' })
  @ApiErrors([400, '`week` is not in the format YYYY-Www.'])
  list(@CurrentMembership() m: HouseMembership, @Query() query: ListAssignmentsQuery): Promise<WeekViewDto> {
    return this.assignments.weekView(m.houseId, query.week);
  }

  @Post('schedules/preview')
  @ApiOperation({
    summary: 'Preview a schedule (dry run)',
    description:
      'Runs the schedule generator for the current or next week without saving anything, and returns the proposed ' +
      'assignments with the random seed and the reasons if the fairness fence had to be relaxed. Use it to show members what a ' +
      'generation or shuffle would produce.',
  })
  @ApiCreatedResponse({ type: PreviewResultDto, description: 'The proposed schedule. Nothing was saved.' })
  @ApiErrors(400, [422, 'Code `WEEK_OUT_OF_RANGE`: only the current or the next week can be previewed.'])
  preview(@CurrentMembership() m: HouseMembership, @Body() dto: PreviewScheduleDto): Promise<PreviewResultDto> {
    return this.assignments.preview(m.houseId, dto.weekKey);
  }

  @Post('assignments/shuffle')
  @ApiOperation({
    summary: 'Generate or re-roll a week schedule',
    description:
      '`mode: CREATE` generates the schedule of a week that has none (any member may do it); if a schedule already exists it ' +
      'is returned unchanged with `changed: false`. `mode: REROLL` regenerates an existing schedule with a new seed and is ' +
      'restricted to the admin; it works only before the week starts, only while no assignment has been submitted or verified, ' +
      'and at most twice per week. Only the current or next week can be generated. Broadcasts `chore:shuffled`.',
  })
  @ApiCreatedResponse({ type: ShuffleResultDto, description: 'The resulting schedule and whether it changed.' })
  @ApiErrors(
    400,
    [403, 'The caller is not a member, or tried REROLL without being the admin (`FORBIDDEN`).'],
    [409, 'Codes: `SCHEDULE_LOCKED` (the week already started), `SCHEDULE_HAS_ACTIVITY` (an assignment was already submitted or verified), `REROLL_LIMIT`, `SWAP_PENDING_IN_WEEK` (cancel pending swap requests first).'],
    [422, 'Code `WEEK_OUT_OF_RANGE`: only the current or the next week.'],
  )
  shuffle(@CurrentMembership() m: HouseMembership, @Body() dto: ShuffleAssignmentsDto): Promise<ShuffleResultDto> {
    return this.assignments.shuffle(m.houseId, m, dto);
  }
}

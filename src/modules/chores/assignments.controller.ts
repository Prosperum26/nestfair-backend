import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import {
  type HouseMembership,
  HouseMemberGuard,
} from '../houses/guards/house-member.guard.js';
import {
  HouseRoles,
  HouseRolesGuard,
} from '../houses/guards/house-roles.guard.js';
import { AssignmentsService } from './assignments.service.js';
import { AssignmentDto, ShuffleResultDto } from './dto/assignment-response.dto.js';
import { ListAssignmentsQuery, ShuffleAssignmentsDto } from './dto/week-key.dto.js';

@ApiTags('chores')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({
  description: 'Không phải thành viên nhà này (hoặc không đủ quyền)',
})
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard, HouseRolesGuard)
@Controller('houses/:houseId/assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Lịch trực của một tuần (mặc định tuần hiện tại)' })
  @ApiOkResponse({ type: [AssignmentDto] })
  @ApiBadRequestResponse({ description: 'weekKey sai định dạng' })
  list(
    @CurrentMembership() m: HouseMembership,
    @Query() query: ListAssignmentsQuery,
  ): Promise<AssignmentDto[]> {
    return this.assignments.list(m.houseId, query.weekKey);
  }

  @Post('shuffle')
  @HouseRoles('ADMIN')
  @ApiOperation({
    summary:
      'Trưởng phòng xếp lại lịch tuần (giữ các ca đã nộp, chỉ xếp lại ca còn TODO)',
  })
  @ApiCreatedResponse({ type: ShuffleResultDto })
  @ApiBadRequestResponse({
    description: 'Chưa có việc / thành viên, hoặc tuần đã qua',
  })
  shuffle(
    @CurrentMembership() m: HouseMembership,
    @Body() dto: ShuffleAssignmentsDto,
  ): Promise<ShuffleResultDto> {
    return this.assignments.shuffle(m.houseId, dto.weekKey);
  }
}

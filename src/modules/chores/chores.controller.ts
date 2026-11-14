import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import {
  type HouseMembership,
  HouseMemberGuard,
} from '../houses/guards/house-member.guard.js';
import {
  HouseRoles,
  HouseRolesGuard,
} from '../houses/guards/house-roles.guard.js';
import { ChoresService } from './chores.service.js';
import { ChoreDto } from './dto/chore-response.dto.js';
import { CreateChoreDto } from './dto/create-chore.dto.js';
import { ListChoresQuery } from './dto/list-chores.query.js';
import { UpdateChoreDto } from './dto/update-chore.dto.js';

@ApiTags('chores')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house, or the action needs the admin role.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard, HouseRolesGuard)
@Controller('houses/:houseId/chores')
export class ChoresController {
  constructor(private readonly chores: ChoresService) {}

  @Get()
  @ApiOperation({
    summary: 'List chores',
    description:
      'Returns the recurring chores defined for the house. By default only active chores are returned; pass ' +
      '`includeInactive=true` to include paused ones. The system chore used by the Lucky Wheel is not a normal chore and is not listed.',
  })
  @ApiOkResponse({ type: [ChoreDto], description: 'Chores of the house.' })
  list(
    @CurrentMembership() m: HouseMembership,
    @Query() query: ListChoresQuery,
  ): Promise<ChoreDto[]> {
    return this.chores.list(m.houseId, query.includeInactive);
  }

  @Post()
  @HouseRoles('ADMIN')
  @ApiOperation({
    summary: 'Create a chore (admin)',
    description:
      'Defines a new recurring chore with its weight, frequency, weekdays, deadline time and rotation mode. It is picked up by ' +
      'the next schedule generation (the weekly cron job or a manual shuffle). Admin only.',
  })
  @ApiCreatedResponse({ type: ChoreDto, description: 'The new chore.' })
  @ApiErrors(400)
  create(
    @CurrentMembership() m: HouseMembership,
    @Body() dto: CreateChoreDto,
  ): Promise<ChoreDto> {
    return this.chores.create(m.houseId, m.id, dto);
  }

  @Patch(':choreId')
  @HouseRoles('ADMIN')
  @ApiParam({ name: 'choreId', format: 'uuid', description: 'Id of the chore.' })
  @ApiOperation({
    summary: 'Update or pause a chore (admin)',
    description:
      'Partial update of a chore\'s name, weight, frequency, weekdays, deadline time or rotation mode. Setting `isActive` to ' +
      'false pauses the chore: it is no longer scheduled and its future TODO assignments are cancelled. Assignments that already ' +
      'exist keep the name and weight they were generated with. The system chore of the Lucky Wheel cannot be edited. Admin only.',
  })
  @ApiOkResponse({ type: ChoreDto, description: 'The updated chore.' })
  @ApiErrors(
    [403, 'Code `SYSTEM_CHORE` for the Lucky Wheel system chore, or the caller is not the admin.'],
    [404, 'The chore does not belong to this house.'],
  )
  update(
    @CurrentMembership() m: HouseMembership,
    @Param('choreId', ParseUUIDPipe) choreId: string,
    @Body() dto: UpdateChoreDto,
  ): Promise<ChoreDto> {
    return this.chores.update(m.houseId, m.id, choreId, dto);
  }
}

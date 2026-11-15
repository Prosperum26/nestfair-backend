import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  ApiNoContentResponse,
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
      '`includeInactive=true` to include paused ones, or `archived=true` to list only archived ones. The system chore used by the Lucky Wheel is not a normal chore and is not listed.',
  })
  @ApiOkResponse({ type: [ChoreDto], description: 'Chores of the house.' })
  list(
    @CurrentMembership() m: HouseMembership,
    @Query() query: ListChoresQuery,
  ): Promise<ChoreDto[]> {
    return this.chores.list(m.houseId, { includeInactive: query.includeInactive, archived: query.archived });
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

  @Delete(':choreId')
  @HouseRoles('ADMIN')
  @ApiParam({ name: 'choreId', format: 'uuid', description: 'Id of the chore.' })
  @ApiOperation({
    summary: 'Archive a chore (admin)',
    description:
      'The "delete" of the UI. The chore disappears from every list and is never scheduled again, but its history, points and ' +
      'debts are kept. An active chore has its future TODO or unassigned slots cancelled (same as pausing). Idempotent: ' +
      'archiving an archived chore returns it unchanged. Admin only.',
  })
  @ApiOkResponse({ type: ChoreDto, description: 'The archived chore.' })
  @ApiErrors(
    [403, 'Code `SYSTEM_CHORE` for the Lucky Wheel system chore, or the caller is not the admin.'],
    [404, 'The chore does not belong to this house.'],
  )
  archive(
    @CurrentMembership() m: HouseMembership,
    @Param('choreId', ParseUUIDPipe) choreId: string,
  ): Promise<ChoreDto> {
    return this.chores.archive(m.houseId, m.id, choreId);
  }

  @Post(':choreId/restore')
  @HttpCode(200)
  @HouseRoles('ADMIN')
  @ApiParam({ name: 'choreId', format: 'uuid', description: 'Id of the chore.' })
  @ApiOperation({
    summary: 'Restore an archived chore (admin)',
    description:
      'Brings an archived chore back as a paused chore (`isActive` stays false): the admin re-enables it to schedule it again. Admin only.',
  })
  @ApiOkResponse({ type: ChoreDto, description: 'The restored (paused) chore.' })
  @ApiErrors(
    [403, 'The caller is not the admin.'],
    [404, 'The chore does not belong to this house.'],
    [409, 'Code `CHORE_NOT_ARCHIVED`: the chore is not archived.'],
  )
  restore(
    @CurrentMembership() m: HouseMembership,
    @Param('choreId', ParseUUIDPipe) choreId: string,
  ): Promise<ChoreDto> {
    return this.chores.restore(m.houseId, m.id, choreId);
  }

  @Delete(':choreId/permanent')
  @HttpCode(204)
  @HouseRoles('ADMIN')
  @ApiParam({ name: 'choreId', format: 'uuid', description: 'Id of the chore.' })
  @ApiOperation({
    summary: 'Delete an archived chore permanently (admin)',
    description:
      'Removes the chore and its never-used slots from the database. Only allowed when the chore is archived and has never had ' +
      'any activity (no done, submitted, rejected or missed slot, no debt, swap request or wheel result). The archived list marks ' +
      'such chores with `canPurge: true`. Admin only.',
  })
  @ApiNoContentResponse({ description: 'The chore was deleted.' })
  @ApiErrors(
    [403, 'The caller is not the admin.'],
    [404, 'The chore does not belong to this house (or was already deleted).'],
    [409, 'Code `CHORE_NOT_ARCHIVED` (archive it first) or `CHORE_HAS_HISTORY` (it can only stay archived).'],
  )
  purge(
    @CurrentMembership() m: HouseMembership,
    @Param('choreId', ParseUUIDPipe) choreId: string,
  ): Promise<void> {
    return this.chores.purge(m.houseId, m.id, choreId);
  }
}

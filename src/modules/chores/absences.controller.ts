import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
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
import { HouseRoles, HouseRolesGuard } from '../houses/guards/house-roles.guard.js';
import { AbsencesService } from './absences.service.js';
import { AuditService } from './audit.service.js';
import { AbsenceDto, AuditLogDto, AuditQuery, BreakDto, CreateAbsenceDto, CreateBreakDto } from './dto/absence.dto.js';
import { BreaksService } from './breaks.service.js';
import { isValidWeekKey, weekStartFromKey } from './week.js';

const COMMON = [
  ApiTags('absences'),
  ApiBearerAuth(),
  ApiErrors(401, [403, 'The caller is not an active member of this house, or the action needs the admin role.']),
  ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' }),
  UseGuards(JwtAuthGuard, HouseMemberGuard, HouseRolesGuard),
];
const decorate = (...d: ClassDecorator[]) => (target: new (...args: never[]) => unknown) => d.forEach((x) => x(target));

@decorate(...(COMMON as ClassDecorator[]))
@Controller('houses/:houseId/absences')
export class AbsencesController {
  constructor(private readonly absences: AbsencesService) {}

  @Get()
  @ApiOperation({
    summary: 'List absences',
    description: 'Returns the absences declared in the house. The scheduler does not assign chores to a member on days they are absent.',
  })
  @ApiOkResponse({ type: [AbsenceDto], description: 'Absences of the house.' })
  list(@CurrentMembership() m: HouseMembership): Promise<AbsenceDto[]> {
    return this.absences.list(m.houseId);
  }

  @Post()
  @ApiOperation({
    summary: 'Declare an absence',
    description:
      'Declares that a member will be away between two dates (inclusive). Members declare their own absence; the admin may ' +
      'declare it for another member via `userId`. TODO assignments of that member inside the range that are still at least ' +
      '24 hours away are handed to other members, and the action is written to the chore audit log.',
  })
  @ApiCreatedResponse({ type: AbsenceDto, description: 'The absence.' })
  @ApiErrors(
    [400, 'Codes: `INVALID_DATE_RANGE` (malformed or reversed dates), `NOT_ELIGIBLE_MEMBER` (the user is not in the house).'],
    [403, 'Code `ADMIN_ONLY` when a non-admin declares an absence for someone else.'],
  )
  create(@CurrentMembership() m: HouseMembership, @Body() dto: CreateAbsenceDto): Promise<AbsenceDto> {
    return this.absences.create(m.houseId, m, dto);
  }

  @Delete(':absenceId')
  @ApiParam({ name: 'absenceId', format: 'uuid', description: 'Id of the absence.' })
  @ApiOperation({
    summary: 'Delete an absence',
    description: 'Removes an absence. Allowed for the absent member, whoever declared it, or the admin. Assignments that were already handed to other members are not restored.',
  })
  @ApiOkResponse({ description: 'Deleted.', schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } })
  @ApiErrors([404, 'The absence does not belong to this house.'])
  async remove(@CurrentMembership() m: HouseMembership, @Param('absenceId', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.absences.remove(m.houseId, m, id);
    return { ok: true };
  }
}

@decorate(...(COMMON as ClassDecorator[]))
@Controller('houses/:houseId/breaks')
export class BreaksController {
  constructor(private readonly breaks: BreaksService) {}

  @Get()
  @ApiOperation({
    summary: 'List house breaks',
    description: 'Returns the periods during which the whole house is away (for example Lunar New Year). No chores are scheduled during a break.',
  })
  @ApiOkResponse({ type: [BreakDto], description: 'Breaks of the house.' })
  list(@CurrentMembership() m: HouseMembership): Promise<BreakDto[]> {
    return this.breaks.list(m.houseId);
  }

  @Post()
  @HouseRoles('ADMIN')
  @ApiOperation({
    summary: 'Create a house break (admin)',
    description: 'Declares that the whole house is away between two dates (inclusive). No assignments are generated for those days and existing ones are cancelled without counting as missed. Admin only.',
  })
  @ApiCreatedResponse({ type: BreakDto, description: 'The break.' })
  @ApiErrors([400, 'Code `INVALID_DATE_RANGE`: malformed or reversed dates.'])
  create(@CurrentMembership() m: HouseMembership, @Body() dto: CreateBreakDto): Promise<BreakDto> {
    return this.breaks.create(m.houseId, m.id, m.userId, dto);
  }

  @Delete(':breakId')
  @HouseRoles('ADMIN')
  @ApiParam({ name: 'breakId', format: 'uuid', description: 'Id of the house break.' })
  @ApiOperation({
    summary: 'Delete a house break (admin)',
    description: 'Removes a break. Assignments cancelled because of it are not restored automatically; shuffle the week to schedule the days again. Admin only.',
  })
  @ApiOkResponse({ description: 'Deleted.', schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } })
  @ApiErrors([404, 'The break does not belong to this house.'])
  async remove(@CurrentMembership() m: HouseMembership, @Param('breakId', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    await this.breaks.remove(m.houseId, m.id, id);
    return { ok: true };
  }
}

@decorate(...(COMMON as ClassDecorator[]))
@Controller('houses/:houseId/chore-audit')
export class ChoreAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'List the chore audit log',
    description: 'Returns the log of chore management actions (re-rolls, admin overrides, absences, automatic approvals, settings changes), newest first. Filter by ISO week, or get the 100 most recent entries.',
  })
  @ApiOkResponse({ type: [AuditLogDto], description: 'Audit log entries.' })
  @ApiErrors([400, '`week` is not in the format YYYY-Www.'])
  list(@CurrentMembership() m: HouseMembership, @Query() query: AuditQuery): Promise<AuditLogDto[]> {
    if (query.week !== undefined && !isValidWeekKey(query.week)) throw new BadRequestException('Tuần không hợp lệ, định dạng đúng là 2026-W41.');
    return this.audit.list(m.houseId, query.week ? weekStartFromKey(query.week) : undefined);
  }
}

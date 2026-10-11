import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
  ApiTags('chores'),
  ApiBearerAuth(),
  ApiUnauthorizedResponse(),
  ApiForbiddenResponse({ description: 'Không phải thành viên nhà này (hoặc không đủ quyền)' }),
  ApiParam({ name: 'houseId', format: 'uuid' }),
  UseGuards(JwtAuthGuard, HouseMemberGuard, HouseRolesGuard),
];
const decorate = (...d: ClassDecorator[]) => (target: new (...args: never[]) => unknown) => d.forEach((x) => x(target));

@decorate(...(COMMON as ClassDecorator[]))
@Controller('houses/:houseId/absences')
export class AbsencesController {
  constructor(private readonly absences: AbsencesService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách khai vắng của cả nhà' })
  @ApiOkResponse({ type: [AbsenceDto] })
  list(@CurrentMembership() m: HouseMembership): Promise<AbsenceDto[]> {
    return this.absences.list(m.houseId);
  }

  @Post()
  @ApiOperation({ summary: 'Khai vắng (bạn, hoặc trưởng phòng khai hộ). Ca TODO còn ≥ 24h trong khoảng vắng được dời cho người khác.' })
  @ApiCreatedResponse({ type: AbsenceDto })
  @ApiBadRequestResponse({ description: 'INVALID_DATE_RANGE | NOT_ELIGIBLE_MEMBER' })
  create(@CurrentMembership() m: HouseMembership, @Body() dto: CreateAbsenceDto): Promise<AbsenceDto> {
    return this.absences.create(m.houseId, m, dto);
  }

  @Delete(':absenceId')
  @ApiParam({ name: 'absenceId', format: 'uuid' })
  @ApiOperation({ summary: 'Xóa khai vắng (chính chủ, người khai hoặc trưởng phòng). Không khôi phục ca đã dời.' })
  @ApiOkResponse({ description: 'Đã xóa' })
  @ApiNotFoundResponse({ description: 'Không thuộc nhà này' })
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
  @ApiOperation({ summary: 'Các khoảng cả nhà vắng' })
  @ApiOkResponse({ type: [BreakDto] })
  list(@CurrentMembership() m: HouseMembership): Promise<BreakDto[]> {
    return this.breaks.list(m.houseId);
  }

  @Post()
  @HouseRoles('ADMIN')
  @ApiOperation({ summary: 'Trưởng phòng đặt khoảng cả nhà vắng: không sinh ca, ca đã có bị hủy (không tính là bỏ ca)' })
  @ApiCreatedResponse({ type: BreakDto })
  @ApiBadRequestResponse({ description: 'INVALID_DATE_RANGE' })
  create(@CurrentMembership() m: HouseMembership, @Body() dto: CreateBreakDto): Promise<BreakDto> {
    return this.breaks.create(m.houseId, m.id, m.userId, dto);
  }

  @Delete(':breakId')
  @HouseRoles('ADMIN')
  @ApiParam({ name: 'breakId', format: 'uuid' })
  @ApiOperation({ summary: 'Xóa khoảng nghỉ (ca đã hủy không tự khôi phục)' })
  @ApiOkResponse({ description: 'Đã xóa' })
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
  @ApiOperation({ summary: 'Nhật ký thao tác việc nhà (re-roll, override, khai vắng, tự duyệt...)' })
  @ApiOkResponse({ type: [AuditLogDto] })
  @ApiBadRequestResponse({ description: 'week sai định dạng' })
  list(@CurrentMembership() m: HouseMembership, @Query() query: AuditQuery): Promise<AuditLogDto[]> {
    if (query.week !== undefined && !isValidWeekKey(query.week)) throw new BadRequestException('Tuần không hợp lệ, định dạng đúng là 2026-W41.');
    return this.audit.list(m.houseId, query.week ? weekStartFromKey(query.week) : undefined);
  }
}

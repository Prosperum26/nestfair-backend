import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { ChoreSettingsService } from './chore-settings.service.js';
import { ChoreSettingsDto } from './dto/chore-response.dto.js';
import { UpdateChoreSettingsDto } from './dto/update-chore-settings.dto.js';

@ApiTags('chore-settings')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house, or the action needs the admin role.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard, HouseRolesGuard)
@Controller('houses/:houseId/chore-settings')
export class ChoreSettingsController {
  constructor(private readonly settings: ChoreSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get chore settings',
    description: 'Returns the house-level chore settings: the grace period (hours) for late photo submissions and the maximum number of assignments one person can get per day. Any member can read them.',
  })
  @ApiOkResponse({ type: ChoreSettingsDto, description: 'Current settings.' })
  get(@CurrentMembership() m: HouseMembership): Promise<ChoreSettingsDto> {
    return this.settings.get(m.houseId);
  }

  @Patch()
  @HouseRoles('ADMIN')
  @ApiOperation({
    summary: 'Update chore settings (admin)',
    description: 'Partial update of the grace period (1-24 hours) and the per-person daily assignment cap (1-6). The change is recorded in the chore audit log. Admin only.',
  })
  @ApiOkResponse({ type: ChoreSettingsDto, description: 'The updated settings.' })
  @ApiErrors([400, 'A value is outside the allowed range.'])
  update(@CurrentMembership() m: HouseMembership, @Body() dto: UpdateChoreSettingsDto): Promise<ChoreSettingsDto> {
    return this.settings.update(m.houseId, m.id, dto);
  }
}

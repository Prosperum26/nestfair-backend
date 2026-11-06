import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
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
import { ChoreSettingsService } from './chore-settings.service.js';
import { ChoreSettingsDto } from './dto/chore-response.dto.js';
import { UpdateChoreSettingsDto } from './dto/update-chore-settings.dto.js';

@ApiTags('chore-settings')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này (hoặc không đủ quyền)' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard, HouseRolesGuard)
@Controller('houses/:houseId/chore-settings')
export class ChoreSettingsController {
  constructor(private readonly settings: ChoreSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Cài đặt việc nhà: ân hạn nộp muộn và số ca tối đa mỗi người mỗi ngày' })
  @ApiOkResponse({ type: ChoreSettingsDto })
  get(@CurrentMembership() m: HouseMembership): Promise<ChoreSettingsDto> {
    return this.settings.get(m.houseId);
  }

  @Patch()
  @HouseRoles('ADMIN')
  @ApiOperation({ summary: 'Trưởng phòng chỉnh cài đặt việc nhà' })
  @ApiOkResponse({ type: ChoreSettingsDto })
  @ApiBadRequestResponse({ description: 'Giá trị ngoài khoảng cho phép' })
  update(@CurrentMembership() m: HouseMembership, @Body() dto: UpdateChoreSettingsDto): Promise<ChoreSettingsDto> {
    return this.settings.update(m.houseId, m.id, dto);
  }
}

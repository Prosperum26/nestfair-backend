import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { CurrentMembership } from './decorators/current-membership.decorator.js';
import { CreateHouseDto } from './dto/create-house.dto.js';
import { HouseDetailDto, HouseSummaryDto } from './dto/house-response.dto.js';
import { JoinHouseDto } from './dto/join-house.dto.js';
import { UpdateHouseDto } from './dto/update-house.dto.js';
import {
  type HouseMembership,
  HouseMemberGuard,
} from './guards/house-member.guard.js';
import { HouseRoles, HouseRolesGuard } from './guards/house-roles.guard.js';
import { HousesService } from './houses.service.js';

@ApiTags('houses')
@ApiBearerAuth()
@ApiErrors(401)
@UseGuards(JwtAuthGuard)
@Controller('houses')
export class HousesController {
  constructor(private readonly houses: HousesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a house',
    description:
      'Creates a house and makes the caller its first member with the `ADMIN` role. The house gets a random 6-character ' +
      'invite code that stays valid for 7 days. A user may belong to several houses. The new house starts with no chores, ' +
      'expenses or rules.',
  })
  @ApiCreatedResponse({ type: HouseDetailDto, description: 'The new house, including its invite code.' })
  @ApiErrors(400)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateHouseDto,
  ): Promise<HouseDetailDto> {
    return this.houses.create(user.id, dto);
  }

  @Post('join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Join a house with an invite code',
    description:
      'Adds the caller to the house that owns the invite code, with the `ROOMMATE` role. The house row is locked while the ' +
      'member count is checked, so two people cannot take the last free place. Fails if the code is unknown, expired, or ' +
      'belongs to a dissolved house (the same 404 for all three, so codes cannot be probed). When the house becomes full, ' +
      'its open roommate listing is closed automatically (`listing:closed`). Broadcasts `member:joined` to the house.',
  })
  @ApiOkResponse({ type: HouseDetailDto, description: 'The house the caller just joined.' })
  @ApiErrors(
    [400, 'The code is not 6 letters or digits.'],
    [404, 'The invite code does not exist or has expired.'],
    [409, 'The caller is already in this house, or the house is full. These two cases have no `code`; read `message`.'],
  )
  join(
    @CurrentUser() user: AuthUser,
    @Body() dto: JoinHouseDto,
  ): Promise<HouseDetailDto> {
    return this.houses.join(user.id, dto.inviteCode);
  }

  @Get()
  @ApiOperation({
    summary: 'List my houses',
    description: 'Returns every house the caller currently belongs to, with member counts and the caller\'s role. Used by the house switcher.',
  })
  @ApiOkResponse({ type: [HouseSummaryDto], description: 'Houses of the caller (possibly empty).' })
  listMine(@CurrentUser() user: AuthUser): Promise<HouseSummaryDto[]> {
    return this.houses.listMine(user.id);
  }

  @Get(':houseId')
  @UseGuards(HouseMemberGuard)
  @ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
  @ApiOperation({
    summary: 'Get house details',
    description:
      'Returns the house settings, the current invite code and its expiry, the rules text and the list of active members. ' +
      'Any active member may call it. Members expose only the last 4 digits of their bank account.',
  })
  @ApiOkResponse({ type: HouseDetailDto, description: 'The house.' })
  @ApiErrors(401, 403, 404)
  detail(
    @CurrentMembership() membership: HouseMembership,
  ): Promise<HouseDetailDto> {
    return this.houses.detail(membership.houseId, membership.role);
  }

  @Patch(':houseId')
  @HouseRoles('ADMIN')
  @UseGuards(HouseMemberGuard, HouseRolesGuard)
  @ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
  @ApiOperation({
    summary: 'Update house settings (admin)',
    description:
      'Partial update of the name, address, capacity and rules. Admin only. Capacity cannot drop below the number of active ' +
      'members. Raising the capacity can reopen a roommate listing that was closed because the house was full (`listing:reopened`). ' +
      'Members who are not admins propose rule changes through the rule-proposal endpoints instead.',
  })
  @ApiOkResponse({ type: HouseDetailDto, description: 'The updated house.' })
  @ApiErrors([400, 'Invalid values, or `maxMembers` is lower than the number of active members.'], 401, [403, 'The caller is not the admin of this house.'], 404)
  update(
    @CurrentMembership() membership: HouseMembership,
    @Body() dto: UpdateHouseDto,
  ): Promise<HouseDetailDto> {
    return this.houses.update(membership.houseId, dto);
  }

  @Post(':houseId/invite-code')
  @HttpCode(HttpStatus.OK)
  @HouseRoles('ADMIN')
  @UseGuards(HouseMemberGuard, HouseRolesGuard)
  @ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
  @ApiOperation({
    summary: 'Regenerate the invite code (admin)',
    description:
      'Replaces the invite code with a new random one and restarts the 7-day validity. The old code stops working ' +
      'immediately. Use it when a code leaked or expired. Admin only.',
  })
  @ApiOkResponse({ type: HouseDetailDto, description: 'The house with its new invite code.' })
  @ApiErrors(401, [403, 'The caller is not the admin of this house.'], 404)
  regenerateInviteCode(
    @CurrentMembership() membership: HouseMembership,
  ): Promise<HouseDetailDto> {
    return this.houses.regenerateInviteCode(membership.houseId);
  }
}

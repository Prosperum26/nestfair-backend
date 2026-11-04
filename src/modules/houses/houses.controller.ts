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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
@ApiUnauthorizedResponse()
@UseGuards(JwtAuthGuard)
@Controller('houses')
export class HousesController {
  constructor(private readonly houses: HousesService) {}

  @Post()
  @ApiOperation({
    summary: 'Tạo nhà mới; người tạo là trưởng phòng, nhận mã mời 6 ký tự',
  })
  @ApiCreatedResponse({ type: HouseDetailDto })
  @ApiBadRequestResponse({ description: 'Dữ liệu không hợp lệ' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateHouseDto,
  ): Promise<HouseDetailDto> {
    return this.houses.create(user.id, dto);
  }

  @Post('join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vào nhà bằng mã mời (vai trò thành viên)' })
  @ApiOkResponse({ type: HouseDetailDto })
  @ApiBadRequestResponse({ description: 'Mã sai định dạng' })
  @ApiNotFoundResponse({ description: 'Mã không tồn tại hoặc đã hết hạn' })
  @ApiConflictResponse({ description: 'Đã ở trong nhà, hoặc nhà đã đủ người' })
  join(
    @CurrentUser() user: AuthUser,
    @Body() dto: JoinHouseDto,
  ): Promise<HouseDetailDto> {
    return this.houses.join(user.id, dto.inviteCode);
  }

  @Get()
  @ApiOperation({ summary: 'Các nhà tôi đang ở (house switcher)' })
  @ApiOkResponse({ type: [HouseSummaryDto] })
  listMine(@CurrentUser() user: AuthUser): Promise<HouseSummaryDto[]> {
    return this.houses.listMine(user.id);
  }

  @Get(':houseId')
  @UseGuards(HouseMemberGuard)
  @ApiParam({ name: 'houseId', format: 'uuid' })
  @ApiOperation({ summary: 'Chi tiết nhà, mã mời và danh sách thành viên' })
  @ApiOkResponse({ type: HouseDetailDto })
  @ApiForbiddenResponse({ description: 'Không phải thành viên nhà này' })
  @ApiNotFoundResponse({ description: 'houseId không hợp lệ' })
  detail(
    @CurrentMembership() membership: HouseMembership,
  ): Promise<HouseDetailDto> {
    return this.houses.detail(membership.houseId, membership.role);
  }

  @Patch(':houseId')
  @HouseRoles('ADMIN')
  @UseGuards(HouseMemberGuard, HouseRolesGuard)
  @ApiParam({ name: 'houseId', format: 'uuid' })
  @ApiOperation({
    summary: 'Trưởng phòng sửa tên, địa chỉ, số người tối đa, nội quy',
  })
  @ApiOkResponse({ type: HouseDetailDto })
  @ApiBadRequestResponse({
    description: 'Dữ liệu không hợp lệ, hoặc số người tối đa thấp hơn số người đang ở',
  })
  @ApiForbiddenResponse({ description: 'Không phải trưởng phòng của nhà này' })
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
  @ApiParam({ name: 'houseId', format: 'uuid' })
  @ApiOperation({ summary: 'Trưởng phòng tạo mã mời mới (mã cũ hết hiệu lực)' })
  @ApiOkResponse({ type: HouseDetailDto })
  @ApiForbiddenResponse({ description: 'Không phải trưởng phòng của nhà này' })
  regenerateInviteCode(
    @CurrentMembership() membership: HouseMembership,
  ): Promise<HouseDetailDto> {
    return this.houses.regenerateInviteCode(membership.houseId);
  }
}

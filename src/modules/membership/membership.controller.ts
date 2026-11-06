import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { DissolveService } from './dissolve.service.js';
import {
  DissolveHouseDto,
  DissolveHouseResultDto,
  KickMemberDto,
  LeaveHouseDto,
  LeavePreviewDto,
  RemoveMemberResultDto,
  TransferAdminDto,
  TransferAdminResultDto,
} from './dto/membership.dto.js';
import { MembershipService } from './membership.service.js';

@ApiTags('houses')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiParam({ name: 'houseId', format: 'uuid' })
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này, hoặc không đủ quyền' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId')
export class MembershipController {
  constructor(
    private readonly membership: MembershipService,
    private readonly dissolveService: DissolveService,
  ) {}

  @Get('members/:userId/leave-preview')
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOperation({ summary: 'Số dư, ca sắp tới, nợ ca của một thành viên trước khi rời / bị xóa (Admin xem mọi người, thành viên xem của mình)' })
  @ApiOkResponse({ type: LeavePreviewDto })
  @ApiNotFoundResponse({ description: 'Người này không ở trong nhà' })
  preview(
    @CurrentMembership() membership: HouseMembership,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<LeavePreviewDto> {
    return this.membership.preview(membership, userId);
  }

  @Post('leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rời nhà (chỉ khi số dư bằng 0). Trưởng phòng phải chọn người nhận quyền.' })
  @ApiOkResponse({ type: RemoveMemberResultDto })
  @ApiBadRequestResponse({ description: 'INVALID_NEW_ADMIN' })
  @ApiConflictResponse({ description: 'HAS_BALANCE (kèm net), LAST_MEMBER, NEW_ADMIN_REQUIRED' })
  leave(@CurrentMembership() membership: HouseMembership, @Body() dto: LeaveHouseDto): Promise<RemoveMemberResultDto> {
    return this.membership.leave(membership, dto);
  }

  @Delete('members/:userId')
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOperation({ summary: 'Trưởng phòng xóa thành viên; còn số dư thì chọn WRITE_OFF hoặc TRANSFER' })
  @ApiOkResponse({ type: RemoveMemberResultDto })
  @ApiBadRequestResponse({ description: 'CANNOT_KICK_SELF, INVALID_TRANSFER_TARGET' })
  @ApiNotFoundResponse({ description: 'Người này không ở trong nhà' })
  @ApiConflictResponse({ description: 'BALANCE_DECISION_REQUIRED (kèm net), CANNOT_KICK_ADMIN' })
  kick(
    @CurrentMembership() membership: HouseMembership,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: KickMemberDto,
  ): Promise<RemoveMemberResultDto> {
    return this.membership.kick(membership, userId, dto);
  }

  @Post('transfer-admin')
  @HttpCode(HttpStatus.OK)
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiOperation({ summary: 'Trưởng phòng chuyển quyền cho thành viên khác' })
  @ApiOkResponse({ type: TransferAdminResultDto })
  @ApiBadRequestResponse({ description: 'INVALID_NEW_ADMIN (chuyển cho chính mình)' })
  @ApiNotFoundResponse({ description: 'Người này không ở trong nhà' })
  transferAdmin(@CurrentMembership() membership: HouseMembership, @Body() dto: TransferAdminDto): Promise<TransferAdminResultDto> {
    return this.membership.transferAdmin(membership, dto);
  }

  @Post('dissolve')
  @HttpCode(HttpStatus.OK)
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiOperation({
    summary: 'Trưởng phòng giải tán nhà (mềm): mọi người rời nhà, việc dở được đóng, ảnh trên Cloudinary được dọn. Cần gõ đúng tên nhà và cả nhà hết nợ.',
  })
  @ApiOkResponse({ type: DissolveHouseResultDto })
  @ApiBadRequestResponse({ description: 'CONFIRM_NAME_MISMATCH' })
  @ApiConflictResponse({ description: 'HAS_BALANCE (kèm membersWithBalance), ALREADY_DISSOLVED' })
  dissolve(@CurrentMembership() membership: HouseMembership, @Body() dto: DissolveHouseDto): Promise<DissolveHouseResultDto> {
    return this.dissolveService.dissolve(membership, dto);
  }
}

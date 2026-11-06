import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
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

@ApiTags('membership')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house, or the action needs the admin role.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId')
export class MembershipController {
  constructor(
    private readonly membership: MembershipService,
    private readonly dissolveService: DissolveService,
  ) {}

  @Get('members/:userId/leave-preview')
  @ApiParam({ name: 'userId', format: 'uuid', description: 'User id of the member to preview.' })
  @ApiOperation({
    summary: 'Preview what leaving would affect',
    description:
      'Shows the consequences of a member leaving or being removed: net balance, pending payment reports, open chore debts, ' +
      'upcoming assignments and whether they are the last member. The admin can preview any member; a regular member can ' +
      'preview only themselves. Read-only; nothing changes.',
  })
  @ApiOkResponse({ type: LeavePreviewDto, description: 'The impact summary.' })
  @ApiErrors([403, 'A non-admin asked about another member (`NOT_ALLOWED`), or the caller is not a member.'], [404, 'Code `MEMBER_NOT_FOUND`: that user is not an active member of this house.'])
  preview(
    @CurrentMembership() membership: HouseMembership,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<LeavePreviewDto> {
    return this.membership.preview(membership, userId);
  }

  @Post('leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Leave the house',
    description:
      'The caller leaves the house (soft: the membership gets a `leftAt` date, history stays visible). Allowed only when ' +
      'the caller\'s net balance is exactly 0. An admin who leaves a house with other members must name the next admin in ' +
      '`newAdminUserId`. The last remaining member cannot leave and should dissolve the house. Pending payment reports are ' +
      'cancelled, open chore debts are closed, and upcoming assignments are redistributed. Broadcasts `member:left` (and ' +
      '`member:role_changed` when the admin changes).',
  })
  @ApiOkResponse({ type: RemoveMemberResultDto, description: 'Summary of what happened to the balance and the upcoming assignments.' })
  @ApiErrors(
    [400, 'Code `INVALID_NEW_ADMIN`: the named successor is not another active member.'],
    [409, 'Codes: `HAS_BALANCE` (the body includes the caller\'s `net`), `LAST_MEMBER`, `NEW_ADMIN_REQUIRED`.'],
  )
  leave(@CurrentMembership() membership: HouseMembership, @Body() dto: LeaveHouseDto): Promise<RemoveMemberResultDto> {
    return this.membership.leave(membership, dto);
  }

  @Delete('members/:userId')
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiParam({ name: 'userId', format: 'uuid', description: 'User id of the member to remove.' })
  @ApiOperation({
    summary: 'Remove a member (admin)',
    description:
      'The admin removes another member from the house (soft removal). If the member has a non-zero balance the admin must ' +
      'choose how to handle it with `mode`: `WRITE_OFF` forgives it, `TRANSFER` moves it to `toUserId`. The member\'s upcoming ' +
      'assignments are redistributed (`shifts: AUTO`) or left empty (`MANUAL`). The admin cannot remove themselves (use leave) ' +
      'or another admin. Broadcasts `member:left`.',
  })
  @ApiOkResponse({ type: RemoveMemberResultDto, description: 'Summary of the removal.' })
  @ApiErrors(
    [400, 'Codes: `CANNOT_KICK_SELF`, `INVALID_TRANSFER_TARGET` (the recipient is not another active member).'],
    [404, 'Code `MEMBER_NOT_FOUND`: that user is not an active member of this house.'],
    [409, 'Codes: `BALANCE_DECISION_REQUIRED` (the body includes `net`; resend with `mode`), `CANNOT_KICK_ADMIN`.'],
  )
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
  @ApiOperation({
    summary: 'Transfer the admin role (admin)',
    description: 'The admin hands the `ADMIN` role to another active member and becomes a regular roommate. A house always has exactly one admin. Broadcasts `member:role_changed`.',
  })
  @ApiOkResponse({ type: TransferAdminResultDto, description: 'The new admin.' })
  @ApiErrors(
    [400, 'Code `INVALID_NEW_ADMIN`: the target is the caller or not an active member.'],
    [404, 'Code `MEMBER_NOT_FOUND`: that user is not an active member of this house.'],
  )
  transferAdmin(@CurrentMembership() membership: HouseMembership, @Body() dto: TransferAdminDto): Promise<TransferAdminResultDto> {
    return this.membership.transferAdmin(membership, dto);
  }

  @Post('dissolve')
  @HttpCode(HttpStatus.OK)
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiOperation({
    summary: 'Dissolve the house (admin)',
    description:
      'Permanently shuts the house down. It is a soft dissolve: nothing is cascade-deleted; the house gets a `dissolvedAt` ' +
      'date, every member leaves, the invite code stops working and the scheduler skips the house. Pending payment reports ' +
      'and swap requests are cancelled, chore debts are closed, future assignments are cancelled, unsent reminders are deleted ' +
      'and the roommate listing is closed. Images stored in Cloudinary (chore proofs, receipts, payment proofs, scans, listing ' +
      'photos) are deleted afterwards in batches; failures are only logged. Preconditions: the admin must retype the exact house ' +
      'name and every member\'s balance must be 0. Broadcasts `house:dissolved` to each member. Cannot be undone.',
  })
  @ApiOkResponse({ type: DissolveHouseResultDto, description: 'Counts of removed members and deleted images.' })
  @ApiErrors(
    [400, 'Code `CONFIRM_NAME_MISMATCH`: `confirmName` does not equal the house name.'],
    [409, 'Codes: `HAS_BALANCE` (the body includes `membersWithBalance`, the number of members who still owe or are owed money), `ALREADY_DISSOLVED`.'],
  )
  dissolve(@CurrentMembership() membership: HouseMembership, @Body() dto: DissolveHouseDto): Promise<DissolveHouseResultDto> {
    return this.dissolveService.dissolve(membership, dto);
  }
}

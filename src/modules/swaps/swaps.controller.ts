import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { coded } from '../../common/coded-exception.js';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { HouseRoles, HouseRolesGuard } from '../houses/guards/house-roles.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateSwapDto } from './dto/create-swap.dto.js';
import { EscalateResultDto, EscalateSwapDto } from './dto/escalate-swap.dto.js';
import { CancelPendingQuery, ListSwapsQuery } from './dto/list-swaps.query.js';
import { RejectSwapDto } from './dto/reject-swap.dto.js';
import { SwapOptionsDto, SwapOptionsQuery } from './dto/swap-options.dto.js';
import { AcceptSwapResultDto, SwapDto, SwapSummaryDto } from './dto/swap-response.dto.js';
import { loadSwapForUser } from './swap-access.js';
import { SwapEscalationService } from './swap-escalation.service.js';
import { SwapOptionsService } from './swap-options.service.js';
import { SwapsService } from './swaps.service.js';
import { SWAP_ERRORS } from './swap-errors.js';

/** `Idempotency-Key` bắt buộc trên các route ghi (spec 9.1). */
function requireKey(raw: string | undefined): string {
  const key = raw?.trim();
  if (!key) {
    const spec = SWAP_ERRORS.IDEMPOTENCY_KEY_REQUIRED;
    throw coded(spec.status, 'IDEMPOTENCY_KEY_REQUIRED', spec.message);
  }
  return key;
}

/** Route theo ca trực, không có houseId trên URL: nhà suy ra từ chính ca (như AssignmentActionsController). */
@ApiTags('swaps')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The assignment is not the caller\'s, or the caller has left the house.'], [404, 'The assignment does not exist (or belongs to a house the caller is not in).'])
@ApiParam({ name: 'assignmentId', format: 'uuid', description: 'Id of the caller\'s own chore assignment. The house is derived from it.' })
@UseGuards(JwtAuthGuard)
@Controller('assignments/:assignmentId')
export class SwapAssignmentController {
  constructor(private readonly options: SwapOptionsService) {}

  @Get('swap-options')
  @ApiOperation({
    summary: 'List swap candidates for my assignment',
    description:
      'Evaluates every possible partner for one of the caller\'s assignments against the swap rules and returns them all, ' +
      'valid or not. `type=EXCHANGE` lists other members\' assignments to swap with; `type=COVER` lists members who could do ' +
      'the assignment for the caller (the compensation, PAYBACK or GIFT, affects which are valid). Each invalid option carries ' +
      'the error code that would be raised, and each valid option carries the soft warnings that must be acknowledged when ' +
      'sending the request. `market` says whether the assignment may be posted to the whole house. Read-only.',
  })
  @ApiOkResponse({ type: SwapOptionsDto, description: 'Candidates and the market flag.' })
  @ApiErrors([400, '`type` or `compensation` is not an allowed value.'])
  swapOptions(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
    @Query() query: SwapOptionsQuery,
  ): Promise<SwapOptionsDto> {
    return this.options.options(user.id, assignmentId, query.type, new Date(), query.compensation);
  }
}

@ApiTags('swaps')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house, or the action needs the admin role.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard, HouseRolesGuard)
@Controller('houses/:houseId/swaps')
export class SwapsHouseController {
  constructor(private readonly swaps: SwapsService) {}

  @Post()
  @ApiOperation({
    summary: 'Send a swap or cover request',
    description:
      'Creates a request to exchange assignments (`EXCHANGE`) or to have someone do an assignment for the caller (`COVER`, ' +
      'to a named member or posted on the market). The rules are checked inside a transaction with row locks: both ' +
      'assignments must be TODO, not overdue and not locked by another pending request; nobody may end up with the same chore ' +
      'twice on one day; an assignment received through a cover cannot be covered again; an exchange must keep everyone ' +
      'inside the 3-week fairness window; fewer than 90 minutes before the deadline is too late, and below 6 hours only the ' +
      'market is allowed. The request expires at the earlier of 24 hours after creation and 6 hours before the deadline. ' +
      'A member may have 3 pending requests and send 10 per day. A GIFT reward is 1,000-500,000 VND. The first call returns ' +
      '201; repeating the call with the same Idempotency-Key returns the original request with 200. Broadcasts ' +
      '`swap:requested`.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated unique key (for example a UUID) that makes the call safe to retry: repeating it returns the original result instead of acting twice. Required; omitting it returns 400 `IDEMPOTENCY_KEY_REQUIRED`.' })
  @ApiCreatedResponse({ type: SwapDto, description: 'The request was created.' })
  @ApiOkResponse({ type: SwapDto, description: 'The same Idempotency-Key was already used; the original request is returned.' })
  @ApiErrors(
    [400, 'Invalid body, or code `IDEMPOTENCY_KEY_REQUIRED`.'],
    [409, 'Code `SLOT_LOCKED`: an assignment already has a pending request; also `SWAP_PENDING_IN_WEEK`.'],
    [422, 'A swap rule is violated (for example `SLOT_NOT_SWAPPABLE`, `FENCE_VIOLATION`, `DUPLICATE_CHORE_SAME_DAY`, `COVER_CHAIN_FORBIDDEN`, `SWAP_TOO_LATE`, `URGENT_MARKET_ONLY`, `REWARD_OUT_OF_RANGE`) or `WARNINGS_NOT_ACKNOWLEDGED`. See the error code catalogue.'],
    [429, 'Codes `SWAP_PENDING_LIMIT` or `SWAP_DAILY_LIMIT`.'],
  )
  async create(
    @CurrentMembership() m: HouseMembership,
    @Body() dto: CreateSwapDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SwapDto> {
    const { created, swap } = await this.swaps.create(m, dto, requireKey(key));
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return swap;
  }

  @Get()
  @ApiOperation({
    summary: 'List swap requests',
    description:
      'Lists swap requests of the house by scope: `INCOMING` (addressed to the caller), `OUTGOING` (sent by the caller) or ' +
      '`MARKET` (open requests posted to everyone, each with an `eligibility` flag telling whether the caller can accept it). ' +
      'The private `reason`, `note` and `rejectReason` fields are only visible to the requester, the target and the admin.',
  })
  @ApiOkResponse({ type: [SwapDto], description: 'Matching requests.' })
  @ApiErrors([400, '`scope` is not INCOMING, OUTGOING or MARKET.'])
  list(@CurrentMembership() m: HouseMembership, @Query() q: ListSwapsQuery): Promise<SwapDto[]> {
    return this.swaps.list(m, q.scope);
  }

  @Delete('pending')
  @HouseRoles('ADMIN')
  @ApiOperation({
    summary: 'Cancel all pending swaps of a week (admin)',
    description: 'Cancels every pending swap request that involves an assignment of the given ISO week. The admin uses it before re-rolling that week\'s schedule, which is refused while requests are pending. Admin only.',
  })
  @ApiOkResponse({ description: 'Number of requests cancelled.', schema: { type: 'object', properties: { cancelled: { type: 'number', example: 2 } } } })
  @ApiErrors([400, '`week` is not in the format YYYY-Www.'])
  cancelPending(@CurrentMembership() m: HouseMembership, @Query() q: CancelPendingQuery): Promise<{ cancelled: number }> {
    return this.swaps.cancelPendingInWeek(m, q.week);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get swap counters',
    description: 'Returns four counters for the dashboard widget: requests waiting for the caller\'s answer, open market requests, chore debts the caller owes and chore debts owed to the caller.',
  })
  @ApiOkResponse({ type: SwapSummaryDto, description: 'The counters.' })
  summary(@CurrentMembership() m: HouseMembership): Promise<SwapSummaryDto> {
    return this.swaps.summary(m);
  }
}

/** Route theo yêu cầu, không có houseId trên URL: nhà suy ra từ chính yêu cầu. */
@ApiTags('swaps')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not allowed to act on this request (not the target / not the requester) or has left the house.'], [404, 'The request does not exist (or belongs to a house the caller is not in).'])
@ApiParam({ name: 'swapId', format: 'uuid', description: 'Id of the swap request. The house is derived from it.' })
@UseGuards(JwtAuthGuard)
@Controller('swaps/:swapId')
export class SwapActionsController {
  constructor(
    private readonly swaps: SwapsService,
    private readonly escalation: SwapEscalationService,
    private readonly prisma: PrismaService,
  ) {}

  @Patch('accept')
  @ApiOperation({
    summary: 'Accept a swap request',
    description:
      'The named target (or any eligible member, for a market request) accepts. All rules are checked again inside the ' +
      'transaction with row locks, so if two people accept at once the second receives 409. On success the assignments are ' +
      'exchanged or handed over; a COVER with PAYBACK creates a chore debt (or offsets an older debt the helper owes the ' +
      'requester), and a COVER with a GIFT reward records a GIFT expense with the helper as payer and the requester owing ' +
      'the amount. Repeating the call with the same Idempotency-Key is safe (`alreadyDone: true`). Broadcasts `swap:accepted`.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated unique key (for example a UUID) that makes the call safe to retry: repeating it returns the original result instead of acting twice. Required; omitting it returns 400 `IDEMPOTENCY_KEY_REQUIRED`.' })
  @ApiOkResponse({ type: AcceptSwapResultDto, description: 'The accepted request.' })
  @ApiErrors(
    [403, 'Codes `NOT_SWAP_TARGET` (the request is addressed to someone else) or `CANNOT_ACCEPT_OWN`.'],
    [409, 'Codes `SWAP_NOT_PENDING`, `SWAP_ALREADY_ACCEPTED`, `SLOT_CHANGED`.'],
    [410, 'Code `SWAP_EXPIRED`: the request has expired.'],
    [422, 'A swap rule is violated now that the request is accepted (see the error code catalogue).'],
  )
  async accept(
    @CurrentUser() user: AuthUser,
    @Param('swapId') swapId: string,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<AcceptSwapResultDto> {
    const idemKey = requireKey(key);
    const { membership } = await loadSwapForUser(this.prisma, user.id, swapId);
    return this.swaps.accept(membership, swapId, idemKey);
  }

  @Patch('reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a swap request',
    description: 'The named target declines the request, optionally with a short message. Market requests have no target and cannot be rejected, only ignored. A target who rejected the same requester twice puts them on a 24-hour cooldown. Broadcasts `swap:rejected`.',
  })
  @ApiOkResponse({ type: SwapDto, description: 'The rejected request.' })
  @ApiErrors([403, 'Code `NOT_SWAP_TARGET`: the request is not addressed to the caller.'], [409, 'Code `SWAP_NOT_PENDING`.'])
  async reject(@CurrentUser() user: AuthUser, @Param('swapId') swapId: string, @Body() dto: RejectSwapDto): Promise<SwapDto> {
    const { membership } = await loadSwapForUser(this.prisma, user.id, swapId);
    return this.swaps.reject(membership, swapId, dto.reason);
  }

  @Post('escalate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Escalate an expired request',
    description:
      'When a request expired without a taker, the requester decides what to do: `ADD_REWARD` adds or raises a gift and reposts ' +
      'it on the market, `RESEND` sends it to another member, `SELF` keeps the assignment. If the requester chooses nothing, the ' +
      'default is SELF. Repost attempts are limited and need enough time before the deadline. Only the requester may call it. ' +
      'Broadcasts `swap:escalated`.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated unique key (for example a UUID) that makes the call safe to retry: repeating it returns the original result instead of acting twice. Required; omitting it returns 400 `IDEMPOTENCY_KEY_REQUIRED`.' })
  @ApiOkResponse({ type: EscalateResultDto, description: 'The handled request and, for ADD_REWARD / RESEND, the new request.' })
  @ApiErrors(
    [403, 'Code `NOT_REQUESTER`: only the requester may escalate.'],
    [409, 'Codes `SWAP_NOT_PENDING`, `SLOT_CHANGED`.'],
    [422, 'Codes `ESCALATE_TOO_LATE`, `ESCALATE_LIMIT`, `REWARD_NOT_INCREASED`, `REWARD_OUT_OF_RANGE`, `NO_RESEND_CANDIDATE`.'],
  )
  async escalate(
    @CurrentUser() user: AuthUser,
    @Param('swapId') swapId: string,
    @Body() dto: EscalateSwapDto,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<EscalateResultDto> {
    const idemKey = requireKey(key);
    const { membership } = await loadSwapForUser(this.prisma, user.id, swapId);
    return this.escalation.escalate(membership, swapId, dto, idemKey);
  }

  @Patch('cancel')
  @ApiOperation({
    summary: 'Cancel my swap request',
    description: 'The requester withdraws a request that is still pending; the locked assignments become available again. Broadcasts `swap:cancelled`.',
  })
  @ApiOkResponse({ type: SwapDto, description: 'The cancelled request.' })
  @ApiErrors([403, 'Code `NOT_REQUESTER`: only the requester may cancel.'], [409, 'Code `SWAP_NOT_PENDING`.'])
  async cancel(@CurrentUser() user: AuthUser, @Param('swapId') swapId: string): Promise<SwapDto> {
    const { membership } = await loadSwapForUser(this.prisma, user.id, swapId);
    return this.swaps.cancel(membership, swapId);
  }
}

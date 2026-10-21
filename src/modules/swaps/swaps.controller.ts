import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { coded } from '../../common/coded-exception.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { HouseRoles, HouseRolesGuard } from '../houses/guards/house-roles.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateSwapDto } from './dto/create-swap.dto.js';
import { CancelPendingQuery, ListSwapsQuery } from './dto/list-swaps.query.js';
import { RejectSwapDto } from './dto/reject-swap.dto.js';
import { SwapOptionsDto, SwapOptionsQuery } from './dto/swap-options.dto.js';
import { AcceptSwapResultDto, SwapDto, SwapSummaryDto } from './dto/swap-response.dto.js';
import { loadSwapForUser } from './swap-access.js';
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
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải ca của bạn / đã rời nhà' })
@ApiNotFoundResponse({ description: 'Không tìm thấy ca trực (hoặc ca của nhà khác)' })
@ApiParam({ name: 'assignmentId', format: 'uuid' })
@UseGuards(JwtAuthGuard)
@Controller('assignments/:assignmentId')
export class SwapAssignmentController {
  constructor(private readonly options: SwapOptionsService) {}

  @Get('swap-options')
  @ApiOperation({ summary: 'Ứng viên đổi ca / nhờ trực dùm cho ca của bạn, kèm lý do không chọn được và cảnh báo' })
  @ApiOkResponse({ type: SwapOptionsDto })
  @ApiBadRequestResponse({ description: 'type không hợp lệ' })
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
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard, HouseRolesGuard)
@Controller('houses/:houseId/swaps')
export class SwapsHouseController {
  constructor(private readonly swaps: SwapsService) {}

  @Post()
  @ApiOperation({ summary: 'Gửi yêu cầu đổi ca. Cùng Idempotency-Key gửi lại thì trả yêu cầu cũ (200)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: SwapDto })
  @ApiOkResponse({ type: SwapDto, description: 'Gửi lại với cùng Idempotency-Key' })
  @ApiBadRequestResponse({ description: 'DTO sai, hoặc IDEMPOTENCY_KEY_REQUIRED' })
  @ApiConflictResponse({ description: 'SLOT_LOCKED' })
  @ApiUnprocessableEntityResponse({ description: 'Vi phạm quy tắc đổi ca (mã ở spec 9.3) hoặc WARNINGS_NOT_ACKNOWLEDGED' })
  @ApiTooManyRequestsResponse({ description: 'SWAP_PENDING_LIMIT | SWAP_DAILY_LIMIT' })
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
  @ApiOperation({ summary: 'Danh sách yêu cầu theo phạm vi: INCOMING (gửi tới bạn), OUTGOING (bạn gửi), MARKET (Chợ ca, kèm eligibility)' })
  @ApiOkResponse({ type: [SwapDto] })
  @ApiBadRequestResponse({ description: 'scope không hợp lệ' })
  list(@CurrentMembership() m: HouseMembership, @Query() q: ListSwapsQuery): Promise<SwapDto[]> {
    return this.swaps.list(m, q.scope);
  }

  @Delete('pending')
  @HouseRoles('ADMIN')
  @ApiOperation({ summary: 'Trưởng phòng hủy mọi yêu cầu đổi ca đang chờ của một tuần (trước khi xáo lại lịch)' })
  @ApiOkResponse({ schema: { type: 'object', properties: { cancelled: { type: 'number' } } } })
  @ApiBadRequestResponse({ description: 'week sai định dạng' })
  cancelPending(@CurrentMembership() m: HouseMembership, @Query() q: CancelPendingQuery): Promise<{ cancelled: number }> {
    return this.swaps.cancelPendingInWeek(m, q.week);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Số đếm cho widget Dashboard: chờ bạn trả lời, Chợ ca, nợ ca hai chiều' })
  @ApiOkResponse({ type: SwapSummaryDto })
  summary(@CurrentMembership() m: HouseMembership): Promise<SwapSummaryDto> {
    return this.swaps.summary(m);
  }
}

/** Route theo yêu cầu, không có houseId trên URL: nhà suy ra từ chính yêu cầu. */
@ApiTags('swaps')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải người được phép / đã rời nhà' })
@ApiNotFoundResponse({ description: 'Không tìm thấy yêu cầu (hoặc của nhà khác)' })
@ApiParam({ name: 'swapId', format: 'uuid' })
@UseGuards(JwtAuthGuard)
@Controller('swaps/:swapId')
export class SwapActionsController {
  constructor(
    private readonly swaps: SwapsService,
    private readonly prisma: PrismaService,
  ) {}

  @Patch('accept')
  @ApiOperation({ summary: 'Chấp nhận: kiểm lại quy tắc trong transaction; người đến sau nhận 409' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: AcceptSwapResultDto })
  @ApiConflictResponse({ description: 'SWAP_NOT_PENDING | SWAP_ALREADY_ACCEPTED | SLOT_CHANGED' })
  @ApiUnprocessableEntityResponse({ description: 'SWAP_EXPIRED được trả 410' })
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
  @ApiOperation({ summary: 'Người nhận đích danh từ chối (lời nhắn tối đa 100 ký tự)' })
  @ApiOkResponse({ type: SwapDto })
  @ApiConflictResponse({ description: 'SWAP_NOT_PENDING' })
  async reject(@CurrentUser() user: AuthUser, @Param('swapId') swapId: string, @Body() dto: RejectSwapDto): Promise<SwapDto> {
    const { membership } = await loadSwapForUser(this.prisma, user.id, swapId);
    return this.swaps.reject(membership, swapId, dto.reason);
  }

  @Patch('cancel')
  @ApiOperation({ summary: 'Người gửi hủy khi yêu cầu còn chờ' })
  @ApiOkResponse({ type: SwapDto })
  @ApiConflictResponse({ description: 'SWAP_NOT_PENDING' })
  async cancel(@CurrentUser() user: AuthUser, @Param('swapId') swapId: string): Promise<SwapDto> {
    const { membership } = await loadSwapForUser(this.prisma, user.id, swapId);
    return this.swaps.cancel(membership, swapId);
  }
}

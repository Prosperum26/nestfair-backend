import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { ListSpinsQuery, SpinWheelDto, VoidSpinDto, WheelOptionsDto, WheelSpinDto } from './dto/wheel.dto.js';
import { WheelService } from './wheel.service.js';

@ApiTags('wheel')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/wheel')
export class HouseWheelController {
  constructor(private readonly wheel: WheelService) {}

  @Get('options')
  @ApiOperation({ summary: 'Dữ liệu mở modal vòng quay: thành viên (cờ vắng hôm nay), chọn sẵn, các mốc hạn, lượt còn lại' })
  @ApiOkResponse({ type: WheelOptionsDto })
  options(@CurrentMembership() m: HouseMembership): Promise<WheelOptionsDto> {
    return this.wheel.options(m.houseId);
  }

  @Post('spin')
  @ApiOperation({
    summary:
      'Quay: server chọn người trúng bằng crypto.randomInt, ghi nhật ký + ca WHEEL rồi phát wheel:spinning. Cùng Idempotency-Key trả lại vòng cũ (200).',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Mỗi lần bấm Quay một key; thử lại khi lỗi mạng dùng lại key cũ' })
  @ApiCreatedResponse({ type: WheelSpinDto })
  @ApiOkResponse({ type: WheelSpinDto, description: 'Trùng Idempotency-Key: vòng đã tạo trước đó' })
  @ApiBadRequestResponse({ description: 'Dữ liệu không hợp lệ / thiếu Idempotency-Key / có trường lạ (vd. winnerId)' })
  @ApiConflictResponse({ description: 'WHEEL_BUSY (kèm retryAfterMs, spinId)' })
  @ApiUnprocessableEntityResponse({
    description: 'WHEEL_NEEDS_2_ELIGIBLE | PARTICIPANT_NOT_MEMBER | PARTICIPANT_ABSENT | PARTICIPANT_DUPLICATE | WHEEL_HOUSE_BREAK | WHEEL_DUE_INVALID',
  })
  @ApiTooManyRequestsResponse({ description: 'WHEEL_RATE_LIMIT: tối đa 5 vòng/giờ, 10 vòng/ngày mỗi nhà' })
  async spin(
    @CurrentMembership() m: HouseMembership,
    @Body() dto: SpinWheelDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WheelSpinDto> {
    const { created, spin } = await this.wheel.spin(m, dto, key);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return spin;
  }

  @Get('current')
  @ApiOperation({ summary: 'Vòng đang quay hoặc vừa xong trong 60 giây (để vào giữa chừng / nối lại); không có thì 204' })
  @ApiOkResponse({ type: WheelSpinDto })
  @ApiNoContentResponse({ description: 'Không có vòng nào gần đây' })
  async current(@CurrentMembership() m: HouseMembership, @Res({ passthrough: true }) res: Response): Promise<WheelSpinDto | undefined> {
    const spin = await this.wheel.current(m.houseId);
    if (!spin) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return spin;
  }

  @Get('spins')
  @ApiOperation({ summary: 'Lịch sử vòng quay kèm người tham gia và người trúng (minh bạch)' })
  @ApiOkResponse({ type: [WheelSpinDto] })
  history(@CurrentMembership() m: HouseMembership, @Query() q: ListSpinsQuery): Promise<WheelSpinDto[]> {
    return this.wheel.history(m.houseId, q.limit);
  }
}

@ApiTags('wheel')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@UseGuards(JwtAuthGuard)
@Controller('wheel/spins')
export class WheelSpinsController {
  constructor(private readonly wheel: WheelService) {}

  @Post(':spinId/void')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'spinId', format: 'uuid' })
  @ApiOperation({ summary: 'Trưởng phòng hủy vòng quay (gõ sai tên việc…): ca WHEEL còn TODO → CANCELLED' })
  @ApiOkResponse({ type: WheelSpinDto })
  @ApiForbiddenResponse({ description: 'ADMIN_ONLY' })
  @ApiNotFoundResponse({ description: 'Không có vòng này / không thuộc nhà của bạn' })
  @ApiConflictResponse({ description: 'ASSIGNMENT_STATE_CHANGED: ca đã nộp / đổi trạng thái / đã hủy' })
  void(@CurrentUser() user: AuthUser, @Param('spinId', ParseUUIDPipe) spinId: string, @Body() dto: VoidSpinDto): Promise<WheelSpinDto> {
    return this.wheel.void(user.id, spinId, dto.reason);
  }
}

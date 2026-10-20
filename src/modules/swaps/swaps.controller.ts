import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { SwapOptionsDto, SwapOptionsQuery } from './dto/swap-options.dto.js';
import { SwapOptionsService } from './swap-options.service.js';

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

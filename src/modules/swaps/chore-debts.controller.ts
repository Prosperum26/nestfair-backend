import { Body, Controller, Get, Headers, Param, Patch, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { coded } from '../../common/coded-exception.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { ChoreDebtService } from './chore-debt.service.js';
import { DebtDto, ListDebtsQuery } from './dto/debt-response.dto.js';
import { PaybackBodyDto, PaybackOptionsDto, PaybackResultDto } from './dto/payback.dto.js';
import { SWAP_ERRORS } from './swap-errors.js';
import { PaybackService } from './payback.service.js';

@ApiTags('swaps')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/chore-debts')
export class ChoreDebtsController {
  constructor(private readonly debts: ChoreDebtService) {}

  @Get()
  @ApiOperation({ summary: 'Sổ nợ ca đang mở. mine = bạn nợ hoặc được nợ; all = cả nhà' })
  @ApiOkResponse({ type: [DebtDto] })
  @ApiBadRequestResponse({ description: 'scope không hợp lệ' })
  list(@CurrentMembership() m: HouseMembership, @Query() q: ListDebtsQuery): Promise<DebtDto[]> {
    return this.debts.list(m, q.scope);
  }
}

/** Route theo khoản nợ, không có houseId trên URL: nhà suy ra từ chính khoản nợ. */
@ApiTags('swaps')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'NOT_CREDITOR: chỉ người được làm bù mới chọn ca bù hoặc tha nợ' })
@ApiNotFoundResponse({ description: 'Không tìm thấy khoản nợ (hoặc của nhà khác)' })
@ApiParam({ name: 'debtId', format: 'uuid' })
@UseGuards(JwtAuthGuard)
@Controller('chore-debts/:debtId')
export class ChoreDebtActionsController {
  constructor(private readonly payback: PaybackService) {}

  @Get('payback-options')
  @ApiOperation({ summary: 'Ca của bạn hợp lệ để chọn làm ca bù, kèm lý do với ca không chọn được' })
  @ApiOkResponse({ type: PaybackOptionsDto })
  @ApiConflictResponse({ description: 'PAYBACK_WINDOW_NOT_OPEN' })
  options(@CurrentUser() user: AuthUser, @Param('debtId') debtId: string): Promise<PaybackOptionsDto> {
    return this.payback.paybackOptions(user.id, debtId);
  }

  @Patch('payback')
  @ApiOperation({ summary: 'Chọn một ca của bạn để người nợ làm bù. Chọn lại cùng ca thì trả kết quả cũ' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: PaybackResultDto })
  @ApiConflictResponse({ description: 'PAYBACK_WINDOW_NOT_OPEN | PAYBACK_ALREADY_CHOSEN | DEBT_NOT_OPEN' })
  @ApiUnprocessableEntityResponse({ description: 'IDEMPOTENCY_KEY_REUSED: cùng Idempotency-Key nhưng khác ca | ca không hợp lệ (PAYBACK_TOO_SOON, TARGET_ABSENT…)' })
  pick(
    @CurrentUser() user: AuthUser,
    @Param('debtId') debtId: string,
    @Body() dto: PaybackBodyDto,
    @Headers('idempotency-key') key: string | undefined,
  ): Promise<PaybackResultDto> {
    const idemKey = key?.trim();
    if (!idemKey) {
      const spec = SWAP_ERRORS.IDEMPOTENCY_KEY_REQUIRED;
      throw coded(spec.status, 'IDEMPOTENCY_KEY_REQUIRED', spec.message);
    }
    return this.payback.payback(user.id, debtId, dto.assignmentId, idemKey);
  }

  @Patch('forgive')
  @ApiOperation({ summary: 'Tha nợ. Nếu ca bù còn chưa làm thì trả lại cho bạn' })
  @ApiOkResponse({ schema: { type: 'object', properties: { debtId: { type: 'string' }, status: { type: 'string', example: 'FORGIVEN' } } } })
  @ApiConflictResponse({ description: 'DEBT_NOT_FORGIVABLE: ca bù đã được làm | DEBT_NOT_OPEN' })
  forgive(@CurrentUser() user: AuthUser, @Param('debtId') debtId: string) {
    return this.payback.forgive(user.id, debtId);
  }
}

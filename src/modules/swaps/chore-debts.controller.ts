import { Body, Controller, Get, Headers, Param, Patch, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { coded } from '../../common/coded-exception.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { ChoreDebtService } from './chore-debt.service.js';
import { DebtGroupsResponseDto, ListDebtsQuery } from './dto/debt-response.dto.js';
import { PaybackBodyDto, PaybackOptionsDto, PaybackResultDto } from './dto/payback.dto.js';
import { SWAP_ERRORS } from './swap-errors.js';
import { PaybackService } from './payback.service.js';

@ApiTags('chore-debts')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/chore-debts')
export class ChoreDebtsController {
  constructor(private readonly debts: ChoreDebtService) {}

  @Get()
  @ApiOperation({
    summary: 'List chore debts',
    description:
      'A chore debt arises when a member covers another member\'s assignment in exchange for a payback: the covered member ' +
      '(debtor) owes the helper (creditor) one assignment of equal effort. This returns open debts and debts closed in the last ' +
      '30 days, grouped by (debtor, creditor) pair, at most 100 groups. `scope=mine` keeps only debts involving the caller; ' +
      '`scope=all` returns the whole house. Weights count chore effort, not money.',
  })
  @ApiOkResponse({ type: DebtGroupsResponseDto, description: 'Debt groups.' })
  @ApiErrors([400, '`scope` is not `mine` or `all`.'])
  list(@CurrentMembership() m: HouseMembership, @Query() q: ListDebtsQuery): Promise<DebtGroupsResponseDto> {
    return this.debts.list(m, q.scope);
  }
}

/** Route theo khoản nợ, không có houseId trên URL: nhà suy ra từ chính khoản nợ. */
@ApiTags('chore-debts')
@ApiBearerAuth()
@ApiErrors(401, [403, 'Code `NOT_CREDITOR`: only the creditor (the person who covered the chore) may choose the payback or forgive the debt.'], [404, 'The debt does not exist (or belongs to a house the caller is not in).'])
@ApiParam({ name: 'debtId', format: 'uuid', description: 'Id of the chore debt. The house is derived from it.' })
@UseGuards(JwtAuthGuard)
@Controller('chore-debts/:debtId')
export class ChoreDebtActionsController {
  constructor(private readonly payback: PaybackService) {}

  @Get('payback-options')
  @ApiOperation({
    summary: 'List payback options',
    description: 'For the creditor of a debt: lists their own upcoming assignments in the payback week with a validity flag and, for invalid ones, the reason (too close to the deadline, debtor absent, and so on). Only available once the pick window has opened. Read-only.',
  })
  @ApiOkResponse({ type: PaybackOptionsDto, description: 'Assignments the creditor can hand over.' })
  @ApiErrors([409, 'Code `PAYBACK_WINDOW_NOT_OPEN`: it is too early to choose.'])
  options(@CurrentUser() user: AuthUser, @Param('debtId') debtId: string): Promise<PaybackOptionsDto> {
    return this.payback.paybackOptions(user.id, debtId);
  }

  @Patch('payback')
  @ApiOperation({
    summary: 'Choose a payback assignment',
    description:
      'The creditor picks one of their own upcoming assignments to be done by the debtor as the payback. The assignment is ' +
      'transferred to the debtor and cannot be passed on again. Choosing the same assignment again returns the earlier result ' +
      '(`alreadyDone: true`). If the creditor does not choose before the pick deadline the system chooses automatically.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated unique key (for example a UUID) that makes the call safe to retry: repeating it returns the original result instead of acting twice. Required; omitting it returns 400 `IDEMPOTENCY_KEY_REQUIRED`.' })
  @ApiOkResponse({ type: PaybackResultDto, description: 'The chosen payback assignment.' })
  @ApiErrors(
    [400, 'Code `IDEMPOTENCY_KEY_REQUIRED`.'],
    [409, 'Codes `PAYBACK_WINDOW_NOT_OPEN`, `PAYBACK_ALREADY_CHOSEN`, `DEBT_NOT_OPEN`.'],
    [422, 'Code `IDEMPOTENCY_KEY_REUSED` (same key, different assignment) or the assignment is not valid (`PAYBACK_TOO_SOON`, `PAYBACK_WRONG_WEEK`, `TARGET_ABSENT`, ...).'],
  )
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
  @ApiOperation({
    summary: 'Forgive a debt',
    description: 'The creditor forgives the debt. If a payback assignment was already chosen but not yet done, it is returned to the creditor. Broadcasts `chore_debt:forgiven`.',
  })
  @ApiOkResponse({ description: 'The debt is closed.', schema: { type: 'object', properties: { debtId: { type: 'string', format: 'uuid' }, status: { type: 'string', example: 'FORGIVEN' } } } })
  @ApiErrors([409, 'Codes `DEBT_NOT_FORGIVABLE` (the payback was already done) or `DEBT_NOT_OPEN`.'])
  forgive(@CurrentUser() user: AuthUser, @Param('debtId') debtId: string) {
    return this.payback.forgive(user.id, debtId);
  }
}

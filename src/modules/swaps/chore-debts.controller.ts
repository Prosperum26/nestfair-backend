import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { ChoreDebtService } from './chore-debt.service.js';
import { DebtDto, ListDebtsQuery } from './dto/debt-response.dto.js';

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

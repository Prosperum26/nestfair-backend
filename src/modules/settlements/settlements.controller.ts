import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { PaymentInfoDto, SettlementPlanDto } from './dto/settlement-plan.dto.js';
import { SettlementsService } from './settlements.service.js';

@ApiTags('settlements')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này (hoặc không đủ quyền)' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('plan')
  @ApiOperation({ summary: 'Kế hoạch thanh toán tối ưu (Min Cash Flow): số dư ròng, nợ chéo trước và sau rút gọn' })
  @ApiOkResponse({ type: SettlementPlanDto })
  plan(@CurrentMembership() m: HouseMembership): Promise<SettlementPlanDto> {
    return this.settlements.plan(m);
  }

  @Get('payment-info/:userId')
  @ApiOperation({ summary: 'Tài khoản nhận tiền của một thành viên cùng nhà (ngân hàng, STK, tên chủ tài khoản) để dựng VietQR' })
  @ApiOkResponse({ type: PaymentInfoDto })
  @ApiNotFoundResponse({ description: 'MEMBER_NOT_FOUND | PAYMENT_INFO_MISSING' })
  paymentInfo(@CurrentMembership() m: HouseMembership, @Param('userId', ParseUUIDPipe) userId: string): Promise<PaymentInfoDto> {
    return this.settlements.paymentInfo(m, userId);
  }
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { UploadedUrlDto } from '../expenses/dto/expense-response.dto.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import type { UploadedImage } from '../uploads/image-validation.js';
import { PaymentInfoDto, SettlementPlanDto } from './dto/settlement-plan.dto.js';
import { CreateSettlementDto, ListSettlementsQuery, SettlementDto } from './dto/settlement.dto.js';
import { SettlementActionsService } from './settlement-actions.service.js';
import { SettlementsService } from './settlements.service.js';

/** Multer chặn cứng ở 10MB; validateImageFile trả lỗi 413 thân thiện ở mốc 5MB. */
const HARD_LIMIT_BYTES = 10 * 1024 * 1024;

@ApiTags('settlements')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này (hoặc không đủ quyền)' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/settlements')
export class SettlementsController {
  constructor(
    private readonly settlements: SettlementsService,
    private readonly actions: SettlementActionsService,
  ) {}

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

  @Get()
  @ApiOperation({ summary: 'Lịch sử tất toán (mới nhất trước). Không truyền month thì lấy toàn bộ; scope=mine chỉ giao dịch của bạn.' })
  @ApiOkResponse({ type: [SettlementDto] })
  list(@CurrentMembership() m: HouseMembership, @Query() query: ListSettlementsQuery): Promise<SettlementDto[]> {
    return this.actions.list(m, query);
  }

  @Post()
  @ApiOperation({ summary: 'Báo "Tôi đã chuyển": tạo giao dịch chờ người nhận xác nhận. Phát `settlement:requested`.' })
  @ApiCreatedResponse({ type: SettlementDto })
  @ApiConflictResponse({ description: 'SETTLEMENT_ALREADY_PENDING: đã có báo chuyển chờ xác nhận cho cùng người nhận' })
  @ApiUnprocessableEntityResponse({ description: 'SETTLEMENT_SELF | NOT_A_HOUSE_MEMBER | SETTLEMENT_AMOUNT_EXCEEDS_DEBT | PROOF_URL_INVALID' })
  create(@CurrentMembership() m: HouseMembership, @Body() dto: CreateSettlementDto): Promise<SettlementDto> {
    return this.actions.create(m, dto);
  }

  @Post('proof')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: HARD_LIMIT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: { photo: { type: 'string', format: 'binary', description: 'JPG/PNG/WEBP, tối đa 5MB' } },
    },
  })
  @ApiOperation({ summary: 'Tải ảnh bill chuyển khoản lên, trả URL để gửi kèm khi báo đã chuyển' })
  @ApiCreatedResponse({ type: UploadedUrlDto })
  @ApiServiceUnavailableResponse({ description: 'UPLOAD_UNAVAILABLE: chưa cấu hình / lỗi Cloudinary' })
  uploadProof(@CurrentMembership() m: HouseMembership, @UploadedFile() file: UploadedImage | undefined): Promise<UploadedUrlDto> {
    return this.actions.uploadProof(m, file);
  }

  @Patch(':settlementId/confirm')
  @ApiOperation({ summary: 'Người nhận xác nhận đã nhận tiền: giao dịch được tính vào số dư. Phát `debt:settled`.' })
  @ApiOkResponse({ type: SettlementDto })
  @ApiNotFoundResponse({ description: 'SETTLEMENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'SETTLEMENT_NOT_PENDING: đã xác nhận hoặc đã hủy (kể cả bấm đúp)' })
  confirm(@CurrentMembership() m: HouseMembership, @Param('settlementId', ParseUUIDPipe) id: string): Promise<SettlementDto> {
    return this.actions.confirm(m, id);
  }

  @Patch(':settlementId/cancel')
  @ApiOperation({ summary: 'Người chuyển rút lại, hoặc người nhận báo chưa nhận được. Phát `settlement:cancelled`.' })
  @ApiOkResponse({ type: SettlementDto })
  @ApiNotFoundResponse({ description: 'SETTLEMENT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'SETTLEMENT_NOT_PENDING' })
  cancel(@CurrentMembership() m: HouseMembership, @Param('settlementId', ParseUUIDPipe) id: string): Promise<SettlementDto> {
    return this.actions.cancel(m, id);
  }
}

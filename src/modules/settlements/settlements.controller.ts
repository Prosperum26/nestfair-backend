import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
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
@ApiErrors(401, [403, 'The caller is not an active member of this house.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/settlements')
export class SettlementsController {
  constructor(
    private readonly settlements: SettlementsService,
    private readonly actions: SettlementActionsService,
  ) {}

  @Get('plan')
  @ApiOperation({
    summary: 'Get the debt settlement plan',
    description:
      'Computes every member\'s net balance from all expenses and confirmed settlements, then returns two views: `raw`, the direct debt between each pair ' +
      'of members, and `optimized`, the minimum-cash-flow plan that settles everything with at most N-1 transfers for N members. The optimized transfers ' +
      'also carry any "I have paid" report that is waiting for confirmation. The net balances always add up to zero. Read-only.',
  })
  @ApiOkResponse({ type: SettlementPlanDto, description: 'Balances and the raw and optimized transfer lists.' })
  plan(@CurrentMembership() m: HouseMembership): Promise<SettlementPlanDto> {
    return this.settlements.plan(m);
  }

  @Get('payment-info/:userId')
  @ApiOperation({
    summary: 'Get a member\'s bank account for payment',
    description:
      'Returns the bank BIN, account number and holder name that another member of the same house saved in their profile, so the client can build a VietQR code ' +
      'for the transfer. Only members of this house can be looked up.',
  })
  @ApiParam({ name: 'userId', format: 'uuid', description: 'User id of the member who will receive the money.' })
  @ApiOkResponse({ type: PaymentInfoDto, description: 'The receiving bank account.' })
  @ApiErrors([404, 'Codes `MEMBER_NOT_FOUND` (not a member of this house) or `PAYMENT_INFO_MISSING` (the member has not entered a bank account).'])
  paymentInfo(@CurrentMembership() m: HouseMembership, @Param('userId', ParseUUIDPipe) userId: string): Promise<PaymentInfoDto> {
    return this.settlements.paymentInfo(m, userId);
  }

  @Get()
  @ApiOperation({
    summary: 'List settlements',
    description:
      'Returns the payment history of the house, newest first, including pending, confirmed and cancelled ones. Without `month` the whole history is returned; ' +
      'with `month=YYYY-MM` only that month. `scope=mine` keeps only the transfers the caller paid or received. Read-only.',
  })
  @ApiOkResponse({ type: [SettlementDto], description: 'Settlements matching the filters.' })
  @ApiErrors([400, '`month` or `scope` is invalid.'])
  list(@CurrentMembership() m: HouseMembership, @Query() query: ListSettlementsQuery): Promise<SettlementDto[]> {
    return this.actions.list(m, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Report "I have paid"',
    description:
      'The caller says they transferred money to another member. This creates a `PENDING` settlement that does not change balances yet; it takes effect ' +
      'only when the receiver confirms. The amount is limited by what the caller still owes the receiver (and what the receiver is owed), checked inside a ' +
      'transaction. Only one pending report per payer and receiver pair is allowed at a time. An optional transfer screenshot (uploaded through the proof ' +
      'endpoint) and a note can be attached. Broadcasts `settlement:requested`.',
  })
  @ApiCreatedResponse({ type: SettlementDto, description: 'The pending settlement.' })
  @ApiErrors(
    [400, 'Invalid body.'],
    [409, 'Code `SETTLEMENT_ALREADY_PENDING`: a report to the same receiver is still waiting for confirmation.'],
    [422, 'Codes `SETTLEMENT_SELF` (paying oneself), `NOT_A_HOUSE_MEMBER`, `SETTLEMENT_AMOUNT_EXCEEDS_DEBT` or `PROOF_URL_INVALID`.'],
  )
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
      properties: { photo: { type: 'string', format: 'binary', description: 'Transfer screenshot: JPEG, PNG or WebP, up to 5 MB.' } },
    },
  })
  @ApiOperation({
    summary: 'Upload a transfer screenshot',
    description: 'Uploads a bank-transfer screenshot (multipart field `photo`; JPEG, PNG or WebP, up to 5 MB) and returns its HTTPS URL, to be sent as `proofUrl` when reporting a payment.',
  })
  @ApiCreatedResponse({ type: UploadedUrlDto, description: 'The stored image URL.' })
  @ApiErrors(
    [400, 'Code `PROOF_REQUIRED`: no `photo` file was sent.'],
    [413, 'Code `IMAGE_TOO_LARGE`: the image is larger than 5 MB.'],
    [415, 'Code `UNSUPPORTED_IMAGE`: the file is not a JPEG, PNG or WebP image.'],
    [503, 'Code `UPLOAD_UNAVAILABLE`: image storage is not configured or failed.'],
  )
  uploadProof(@CurrentMembership() m: HouseMembership, @UploadedFile() file: UploadedImage | undefined): Promise<UploadedUrlDto> {
    return this.actions.uploadProof(m, file);
  }

  @Patch(':settlementId/confirm')
  @ApiOperation({
    summary: 'Confirm receipt of money',
    description:
      'The receiver confirms the money arrived. The settlement becomes `CONFIRMED` and is counted in the balances. The change runs in a transaction with a ' +
      'status check, so a double click or two simultaneous confirms apply it only once; the second call gets 409. Only the receiver may confirm. Broadcasts `debt:settled`.',
  })
  @ApiParam({ name: 'settlementId', format: 'uuid', description: 'Id of the settlement to confirm.' })
  @ApiOkResponse({ type: SettlementDto, description: 'The confirmed settlement.' })
  @ApiErrors(
    [403, 'Code `NOT_SETTLEMENT_RECEIVER`: only the receiver may confirm.'],
    [404, 'Code `SETTLEMENT_NOT_FOUND`.'],
    [409, 'Code `SETTLEMENT_NOT_PENDING`: it was already confirmed or cancelled.'],
  )
  confirm(@CurrentMembership() m: HouseMembership, @Param('settlementId', ParseUUIDPipe) id: string): Promise<SettlementDto> {
    return this.actions.confirm(m, id);
  }

  @Patch(':settlementId/cancel')
  @ApiOperation({
    summary: 'Cancel a pending settlement',
    description: 'The payer withdraws the report, or the receiver says the money has not arrived. The settlement becomes `CANCELLED` and balances are unchanged. Only a `PENDING` settlement can be cancelled. Broadcasts `settlement:cancelled`.',
  })
  @ApiParam({ name: 'settlementId', format: 'uuid', description: 'Id of the settlement to cancel.' })
  @ApiOkResponse({ type: SettlementDto, description: 'The cancelled settlement.' })
  @ApiErrors(
    [403, 'Code `NOT_SETTLEMENT_PARTY`: only the payer or the receiver may cancel.'],
    [404, 'Code `SETTLEMENT_NOT_FOUND`.'],
    [409, 'Code `SETTLEMENT_NOT_PENDING`.'],
  )
  cancel(@CurrentMembership() m: HouseMembership, @Param('settlementId', ParseUUIDPipe) id: string): Promise<SettlementDto> {
    return this.actions.cancel(m, id);
  }
}

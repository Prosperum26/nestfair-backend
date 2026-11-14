import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import type { UploadedImage } from '../uploads/image-validation.js';
import { ReceiptScanResultDto } from './dto/receipt-scan-result.dto.js';
import { ReceiptsService } from './receipts.service.js';

/** Multer chặn cứng ở 10MB; validateImageFile trả lỗi 413 thân thiện ở mốc 5MB. */
const HARD_LIMIT_BYTES = 10 * 1024 * 1024;

@ApiTags('receipts')
@ApiBearerAuth()
@ApiErrors(401)
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/expenses')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Post('scan')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: HARD_LIMIT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: { photo: { type: 'string', format: 'binary', description: 'Receipt photo: JPEG, PNG or WebP, up to 5 MB. The web client compresses it to about 1 MB with the long side at most 1600 px before sending.' } },
    },
  })
  @ApiOperation({
    summary: 'Scan a receipt into an expense draft',
    description:
      'Uploads a receipt photo, reads it with Gemini Vision and returns a DRAFT of the expense: merchant, date, line items and the total paid. ' +
      'Nothing is saved to the ledger by this call; the AI never writes data. The user reviews the draft and, on confirmation, the client calls ' +
      '`POST /houses/{houseId}/expenses` with the returned `scanId` as `receiptScanId`. ' +
      'The user must first consent to sending images to Google Gemini (`PATCH /users/me/ocr-consent`). A house may scan 20 receipts per day (Vietnam time). ' +
      'Every returned draft is sanity-checked: if the items differ from the total by more than 2% a warning is added. ' +
      'If the photo is blurry, is not a receipt, or Gemini fails or takes longer than 10 seconds, the call still succeeds with 201 and `mode` set to `MANUAL` ' +
      'so the client can open the manual entry form with the photo already uploaded. Only the total paid is read; tax is not separated out.',
  })
  @ApiCreatedResponse({ type: ReceiptScanResultDto, description: 'A draft to confirm (`mode` DRAFT), or a manual-entry fallback (`mode` MANUAL).' })
  @ApiErrors(
    [400, 'Code `PROOF_REQUIRED`: no `photo` file was sent.'],
    [403, 'Code `OCR_CONSENT_REQUIRED` (the user has not consented to Gemini) or the caller is not a member of this house.'],
    [413, 'Code `IMAGE_TOO_LARGE`: the image is larger than 5 MB.'],
    [415, 'Code `UNSUPPORTED_IMAGE`: the file is not a JPEG, PNG or WebP image.'],
    [429, 'Code `OCR_QUOTA_EXCEEDED`: the house already used its 20 scans today.'],
    [503, 'Code `UPLOAD_UNAVAILABLE`: image storage is not configured or failed.'],
  )
  scan(@CurrentMembership() m: HouseMembership, @UploadedFile() file: UploadedImage | undefined): Promise<ReceiptScanResultDto> {
    return this.receipts.scan(m, file);
  }
}

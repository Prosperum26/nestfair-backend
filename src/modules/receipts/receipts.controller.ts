import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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
@ApiUnauthorizedResponse()
@ApiParam({ name: 'houseId', format: 'uuid' })
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
      properties: { photo: { type: 'string', format: 'binary', description: 'Ảnh hóa đơn JPG/PNG/WEBP, tối đa 5MB (client nén ≤ 1MB, cạnh dài ≤ 1600px)' } },
    },
  })
  @ApiOperation({
    summary: 'Quét hóa đơn bằng Gemini Vision thành bản nháp khoản chi (KHÔNG lưu khoản chi)',
    description:
      'Cần người dùng đã đồng ý gửi ảnh tới Google Gemini (PATCH /users/me/ocr-consent). Tối đa 20 lượt quét mỗi nhà mỗi ngày (giờ VN). ' +
      'Ảnh mờ, không phải hóa đơn hoặc Gemini lỗi/quá 10 giây thì vẫn trả 201 với mode = MANUAL để mở form nhập tay. ' +
      'Khi người dùng xác nhận, gọi POST /expenses với receiptScanId.',
  })
  @ApiCreatedResponse({ type: ReceiptScanResultDto })
  @ApiForbiddenResponse({ description: 'OCR_CONSENT_REQUIRED (chưa đồng ý) hoặc không phải thành viên nhà này' })
  @ApiTooManyRequestsResponse({ description: 'OCR_QUOTA_EXCEEDED: nhà đã dùng hết 20 lượt quét hôm nay' })
  @ApiServiceUnavailableResponse({ description: 'UPLOAD_UNAVAILABLE: chưa cấu hình / lỗi Cloudinary' })
  scan(@CurrentMembership() m: HouseMembership, @UploadedFile() file: UploadedImage | undefined): Promise<ReceiptScanResultDto> {
    return this.receipts.scan(m, file);
  }
}

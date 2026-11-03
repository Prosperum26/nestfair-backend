import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { GeminiReceiptExtractor } from './gemini-receipt.extractor.js';
import { RECEIPT_EXTRACTOR } from './receipt-extractor.js';
import { ReceiptsController } from './receipts.controller.js';
import { ReceiptsService } from './receipts.service.js';

/**
 * Quét hóa đơn bằng AI. Engine đọc ảnh nằm sau token `RECEIPT_EXTRACTOR` (hiện là Gemini) để thay được mà
 * không sửa service. Chưa có `GEMINI_API_KEY` thì client là `null` và mọi lần quét trả về nhập tay.
 */
@Module({
  imports: [AiModule, AuthModule, HousesModule, UploadsModule],
  controllers: [ReceiptsController],
  providers: [
    ReceiptsService,
    { provide: RECEIPT_EXTRACTOR, useClass: GeminiReceiptExtractor },
  ],
})
export class ReceiptsModule {}

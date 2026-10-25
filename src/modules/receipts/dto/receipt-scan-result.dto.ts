import { ApiProperty } from '@nestjs/swagger';
import type { DraftItem, DraftWarning, DraftWarningCode, ReceiptDraft } from '../receipt-sanity.js';
import type { ScanFailureReason } from '../receipt-extractor.js';

const WARNING_CODES: DraftWarningCode[] = ['ITEMS_TOTAL_MISMATCH', 'DATE_MISSING', 'DATE_IN_FUTURE', 'DROPPED_ITEMS', 'AI_NOTE'];
const FAILURE_REASONS: ScanFailureReason[] = ['NOT_A_RECEIPT', 'UNREADABLE', 'AI_TIMEOUT', 'AI_UNAVAILABLE'];

/** Chỉ dùng cho Swagger; dữ liệu thật do `sanitizeReceipt` tạo. */
export class DraftItemDto implements DraftItem {
  @ApiProperty({ example: 'Trứng gà hộp 10' }) name: string;
  @ApiProperty({ example: 1, description: 'Có thể lẻ (0,5 kg)' }) quantity: number;
  @ApiProperty({ example: 32_000, description: 'Thành tiền, số nguyên VNĐ' }) lineTotal: number;
  @ApiProperty({ description: 'AI không chắc về dòng này: giao diện tô vàng và yêu cầu người dùng gán người dùng món' }) uncertain: boolean;
  @ApiProperty({ type: String, nullable: true, example: 'Số lượng bị mờ' }) note: string | null;
}

export class DraftWarningDto implements DraftWarning {
  @ApiProperty({ enum: WARNING_CODES, enumName: 'DraftWarningCode' }) code: DraftWarningCode;
  @ApiProperty() message: string;
}

export class ReceiptDraftDto implements ReceiptDraft {
  @ApiProperty({ example: 'Bách Hóa Xanh' }) merchant: string;
  @ApiProperty({ type: String, nullable: true, example: '2026-10-06', description: 'YYYY-MM-DD; null nếu không đọc được hoặc ở tương lai' }) purchasedAt: string | null;
  @ApiProperty({ type: [DraftItemDto] }) items: DraftItemDto[];
  @ApiProperty({ example: 245_000, description: 'Tổng thực trả, số nguyên VNĐ; không tách thuế' }) total: number;
  @ApiProperty({ type: [DraftWarningDto] }) warnings: DraftWarningDto[];
}

export class ReceiptScanResultDto {
  @ApiProperty({ format: 'uuid', description: 'Truyền vào POST /expenses (receiptScanId) khi người dùng bấm Lưu' }) scanId: string;
  @ApiProperty({ description: 'Ảnh đã tải lên Cloudinary (dùng làm ảnh hóa đơn của khoản chi)' }) imageUrl: string;
  @ApiProperty({ description: 'Thời gian đọc hóa đơn (ms)' }) latencyMs: number;
  @ApiProperty({ enum: ['DRAFT', 'MANUAL'], description: 'DRAFT: có bản nháp để xác nhận. MANUAL: không đọc được, mở form nhập tay (ảnh vẫn dùng được)' }) mode: 'DRAFT' | 'MANUAL';
  @ApiProperty({ enum: FAILURE_REASONS, enumName: 'ScanFailureReason', nullable: true }) reason: ScanFailureReason | null;
  @ApiProperty({ type: String, nullable: true, description: 'Câu tiếng Việt giải thích khi MANUAL' }) message: string | null;
  @ApiProperty({ type: ReceiptDraftDto, nullable: true, description: 'Chỉ là bản nháp: chưa phải khoản chi' }) draft: ReceiptDraftDto | null;
}

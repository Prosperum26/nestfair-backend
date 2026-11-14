import { ApiProperty } from '@nestjs/swagger';
import type { DraftItem, DraftWarning, DraftWarningCode, ReceiptDraft } from '../receipt-sanity.js';
import type { ScanFailureReason } from '../receipt-extractor.js';

const WARNING_CODES: DraftWarningCode[] = ['ITEMS_TOTAL_MISMATCH', 'DATE_MISSING', 'DATE_IN_FUTURE', 'DROPPED_ITEMS', 'AI_NOTE'];
const FAILURE_REASONS: ScanFailureReason[] = ['NOT_A_RECEIPT', 'UNREADABLE', 'AI_TIMEOUT', 'AI_UNAVAILABLE'];

/** Chỉ dùng cho Swagger; dữ liệu thật do `sanitizeReceipt` tạo. */
export class DraftItemDto implements DraftItem {
  @ApiProperty({ example: 'Eggs, box of 10', description: 'Item name as read from the receipt.' })
  name: string;

  @ApiProperty({ example: 1, description: 'Quantity; may be fractional (for example 0.5 kg).' })
  quantity: number;

  @ApiProperty({ example: 32_000, description: 'Line total in integer VND.' })
  lineTotal: number;

  @ApiProperty({ description: 'true when the AI was not sure about this line; the UI highlights it and asks the user to review it and assign who shares the item.' })
  uncertain: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'Quantity is blurry', description: 'Short remark from the AI about the line, or null.' })
  note: string | null;
}

export class DraftWarningDto implements DraftWarning {
  @ApiProperty({
    enum: WARNING_CODES,
    enumName: 'DraftWarningCode',
    description:
      '`ITEMS_TOTAL_MISMATCH` (items differ from the total by more than 2%), `DATE_MISSING` (no date could be read), `DATE_IN_FUTURE` (date discarded), `DROPPED_ITEMS` (unreadable or invalid lines were removed) or `AI_NOTE` (a remark from the AI).',
  })
  code: DraftWarningCode;

  @ApiProperty({ description: 'Localized (Vietnamese) sentence to show to the user.' })
  message: string;
}

export class ReceiptDraftDto implements ReceiptDraft {
  @ApiProperty({ example: 'Bach Hoa Xanh', description: 'Store or merchant name read from the receipt.' })
  merchant: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-10-06',
    description: 'Purchase date (YYYY-MM-DD); null when it could not be read or lies in the future.',
  })
  purchasedAt: string | null;

  @ApiProperty({ type: [DraftItemDto], description: 'Line items read from the receipt.' })
  items: DraftItemDto[];

  @ApiProperty({ example: 245_000, description: 'Total actually paid in integer VND. Tax is not separated out.' })
  total: number;

  @ApiProperty({ type: [DraftWarningDto], description: 'Problems the user should check before saving; empty when the draft looks consistent.' })
  warnings: DraftWarningDto[];
}

export class ReceiptScanResultDto {
  @ApiProperty({ format: 'uuid', description: 'Id of this scan. Send it as `receiptScanId` to POST /houses/{houseId}/expenses when the user confirms the draft.' })
  scanId: string;

  @ApiProperty({ description: 'URL of the uploaded receipt photo; it can be used as the expense\'s receipt image.' })
  imageUrl: string;

  @ApiProperty({ description: 'Time spent reading the receipt, in milliseconds.' })
  latencyMs: number;

  @ApiProperty({ enum: ['DRAFT', 'MANUAL'], description: '`DRAFT` = a draft is available for the user to confirm. `MANUAL` = the receipt could not be read; open the manual entry form (the photo is still usable).' })
  mode: 'DRAFT' | 'MANUAL';

  @ApiProperty({
    enum: FAILURE_REASONS,
    enumName: 'ScanFailureReason',
    nullable: true,
    description: 'Why the scan fell back to MANUAL: `NOT_A_RECEIPT`, `UNREADABLE`, `AI_TIMEOUT` (over 10 seconds) or `AI_UNAVAILABLE`. null when mode is DRAFT.',
  })
  reason: ScanFailureReason | null;

  @ApiProperty({ type: String, nullable: true, description: 'Localized (Vietnamese) sentence explaining a MANUAL result, or null.' })
  message: string | null;

  @ApiProperty({ type: ReceiptDraftDto, nullable: true, description: 'The extracted draft. It is only a suggestion and is not saved as an expense until the user confirms. null when mode is MANUAL.' })
  draft: ReceiptDraftDto | null;
}

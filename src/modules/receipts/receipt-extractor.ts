/** Lý do một lần quét phải chuyển sang nhập tay. */
export type ScanFailureReason = 'NOT_A_RECEIPT' | 'UNREADABLE' | 'AI_TIMEOUT' | 'AI_UNAVAILABLE';

export interface RawReceiptItem {
  name: string;
  quantity?: number;
  lineTotal: number;
  /** AI không chắc về món này (chữ mờ, viết tay, mất góc). */
  uncertain?: boolean;
  note?: string;
}

/** Dữ liệu thô engine OCR trả về, chưa hậu kiểm: không được tin cho tới khi qua `sanitizeReceipt`. */
export interface RawReceipt {
  merchant: string;
  /** YYYY-MM-DD, null nếu không đọc được. */
  purchasedAt: string | null;
  items: RawReceiptItem[];
  total: number;
  warnings: string[];
}

export interface ReceiptImage {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Nguồn đọc hóa đơn. Hiện chỉ có Gemini Vision; engine khác (ví dụ OCR chạy trên trình duyệt) chỉ cần
 * cho ra `RawReceipt`. Lỗi phải ném `ExtractorError` để service chuyển sang nhập tay thay vì trả 500.
 */
export interface ReceiptExtractor {
  extract(image: ReceiptImage): Promise<RawReceipt>;
}

export const RECEIPT_EXTRACTOR = Symbol('RECEIPT_EXTRACTOR');

/** Thông điệp chỉ là mã lý do: chi tiết lỗi của nhà cung cấp (nếu có) nằm ở `cause`, không bao giờ ra client. */
export class ExtractorError extends Error {
  constructor(
    readonly reason: ScanFailureReason,
    options?: ErrorOptions,
  ) {
    super(reason, options);
    this.name = 'ExtractorError';
  }
}

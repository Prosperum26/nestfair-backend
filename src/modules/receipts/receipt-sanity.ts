import { MAX_AMOUNT } from '../expenses/dto/create-expense.dto.js';
import type { RawReceipt, ScanFailureReason } from './receipt-extractor.js';

export type DraftWarningCode = 'ITEMS_TOTAL_MISMATCH' | 'DATE_MISSING' | 'DATE_IN_FUTURE' | 'DROPPED_ITEMS' | 'AI_NOTE';

export interface DraftWarning {
  code: DraftWarningCode;
  message: string;
}

export interface DraftItem {
  name: string;
  quantity: number;
  lineTotal: number;
  uncertain: boolean;
  note: string | null;
}

/** Bản nháp đã hậu kiểm gửi cho client. Chưa phải khoản chi: chỉ thành khoản chi khi người dùng bấm Lưu. */
export interface ReceiptDraft {
  merchant: string;
  /** YYYY-MM-DD hoặc null. */
  purchasedAt: string | null;
  items: DraftItem[];
  total: number;
  warnings: DraftWarning[];
}

export type SanityResult =
  | { mode: 'DRAFT'; draft: ReceiptDraft }
  | { mode: 'MANUAL'; reason: ScanFailureReason; message: string };

/** Đặc tả VI.4: lệch quá 2% giữa tổng các món và tổng hóa đơn thì cảnh báo. */
export const MISMATCH_TOLERANCE_PERCENT = 2;
/** Khớp `ArrayMaxSize` của `items` trong CreateExpenseDto. */
export const MAX_DRAFT_ITEMS = 100;
const MAX_AI_NOTES = 10;
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export const FAILURE_MESSAGES: Record<ScanFailureReason, string> = {
  NOT_A_RECEIPT: 'Ảnh này không giống hóa đơn. Bạn thử chụp lại hoặc nhập tay nhé.',
  UNREADABLE: 'Mình chưa đọc rõ được tổng tiền trên ảnh. Bạn thử chụp lại rõ hơn hoặc nhập tay nhé.',
  AI_TIMEOUT: 'Trợ lý đọc hóa đơn đang chậm. Bạn thử lại sau ít phút hoặc nhập tay nhé.',
  AI_UNAVAILABLE: 'Trợ lý đọc hóa đơn đang bận. Bạn thử lại sau ít phút hoặc nhập tay nhé.',
};

const manual = (reason: ScanFailureReason): SanityResult => ({ mode: 'MANUAL', reason, message: FAILURE_MESSAGES[reason] });

/**
 * Chuỗi do AI trả về không được tin: bỏ ký tự điều khiển, gộp khoảng trắng, cắt theo ký tự (không cắt đôi
 * cặp surrogate). Giao diện chỉ hiển thị dạng văn bản.
 */
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = Array.from(value, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) ? ' ' : ch;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, max).join('');
}

const isUsable = (lineTotal: number) => Number.isSafeInteger(lineTotal) && lineTotal > 0 && lineTotal <= MAX_AMOUNT;

const formatVnd = (n: number) => n.toLocaleString('vi-VN') + 'đ';

/** Ngày thật dạng YYYY-MM-DD (loại 2026-02-30). */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Hậu kiểm dữ liệu thô của OCR (đặc tả VI.4): không đọc được thì chuyển nhập tay, còn lại trả bản nháp kèm
 * cảnh báo. Hàm thuần, không ghi gì.
 */
export function sanitizeReceipt(raw: RawReceipt, now: Date): SanityResult {
  if (raw.items.length === 0) return manual('NOT_A_RECEIPT');
  if (!Number.isSafeInteger(raw.total) || raw.total <= 0 || raw.total > MAX_AMOUNT) return manual('UNREADABLE');

  const usable = raw.items.filter((i) => isUsable(i.lineTotal));
  if (usable.length === 0) return manual('UNREADABLE');
  const kept = usable.slice(0, MAX_DRAFT_ITEMS);

  const items: DraftItem[] = kept.map((i) => {
    const name = clean(i.name, 80);
    const note = clean(i.note, 120);
    return {
      name: name || 'Món chưa rõ tên',
      quantity: typeof i.quantity === 'number' && Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : 1,
      lineTotal: i.lineTotal,
      uncertain: i.uncertain === true || name === '',
      note: note || null,
    };
  });

  const warnings: DraftWarning[] = [];
  const dropped = raw.items.length - kept.length;
  if (dropped > 0) {
    warnings.push({
      code: 'DROPPED_ITEMS',
      message: 'Đã bỏ ' + dropped + ' dòng không dùng được (giảm giá, giá 0đ hoặc quá ' + MAX_DRAFT_ITEMS + ' món). Bạn thêm lại món nếu cần.',
    });
  }

  const itemsSum = items.reduce((s, i) => s + i.lineTotal, 0);
  if (Math.abs(itemsSum - raw.total) * 100 > raw.total * MISMATCH_TOLERANCE_PERCENT) {
    warnings.push({
      code: 'ITEMS_TOTAL_MISMATCH',
      message:
        'Tổng các món (' + formatVnd(itemsSum) + ') không khớp tổng hóa đơn (' + formatVnd(raw.total) +
        '), có thể do giảm giá, thuế hoặc phí. Phần chênh sẽ được chia theo tỷ lệ tiền món.',
    });
  }

  let purchasedAt: string | null = null;
  if (raw.purchasedAt && isRealDate(raw.purchasedAt)) {
    if (Date.parse(raw.purchasedAt + 'T00:00:00+07:00') > now.getTime() + FUTURE_TOLERANCE_MS) {
      warnings.push({ code: 'DATE_IN_FUTURE', message: 'Ngày trên hóa đơn ở tương lai, bạn nhập lại ngày mua nhé.' });
    } else {
      purchasedAt = raw.purchasedAt;
    }
  } else {
    warnings.push({ code: 'DATE_MISSING', message: 'Chưa đọc được ngày mua, bạn kiểm tra lại ngày nhé.' });
  }

  for (const w of raw.warnings.map((x) => clean(x, 160)).filter(Boolean).slice(0, MAX_AI_NOTES)) {
    warnings.push({ code: 'AI_NOTE', message: w });
  }

  return { mode: 'DRAFT', draft: { merchant: clean(raw.merchant, 80), purchasedAt, items, total: raw.total, warnings } };
}

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { coded } from '../../common/coded-exception.js';
import type { Env } from '../../config/env.validation.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { HouseMembership } from '../houses/guards/house-member.guard.js';
import { CloudinaryService } from '../uploads/cloudinary.service.js';
import { type UploadedImage, validateImageFile } from '../uploads/image-validation.js';
import type { ReceiptScanResultDto } from './dto/receipt-scan-result.dto.js';
import { ExtractorError, RECEIPT_EXTRACTOR, type RawReceipt, type ReceiptExtractor, type ScanFailureReason } from './receipt-extractor.js';
import { FAILURE_MESSAGES, type SanityResult, sanitizeReceipt } from './receipt-sanity.js';
import { vnDayStart } from './vn-day.js';

/** Đặc tả XI: tối đa 20 lượt quét mỗi nhà mỗi ngày (giờ VN). */
export const DAILY_SCAN_LIMIT = 20;

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    @Inject(RECEIPT_EXTRACTOR) private readonly extractor: ReceiptExtractor,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Quét một ảnh hóa đơn thành bản nháp. Không bao giờ tạo khoản chi: AI chỉ đề xuất, người dùng xác nhận.
   * Thứ tự kiểm tra: đồng ý (D13) → ảnh hợp lệ → hạn mức nhà → upload → đọc bằng AI. Hạn mức và đồng ý được
   * kiểm tra trước khi tải ảnh lên hoặc gọi Gemini nên bị chặn thì không tốn gì.
   */
  async scan(m: HouseMembership, file: UploadedImage | undefined, now = new Date()): Promise<ReceiptScanResultDto> {
    await this.assertConsent(m.userId);
    validateImageFile(file);
    await this.assertQuota(m.houseId, now);

    const { url } = await this.cloudinary.upload(file.buffer, 'houses/' + m.houseId + '/receipts');

    const started = performance.now();
    let raw: RawReceipt | null = null;
    let outcome: SanityResult;
    try {
      raw = await this.extractor.extract({ buffer: file.buffer, mimeType: file.mimetype });
      outcome = sanitizeReceipt(raw, now);
    } catch (e) {
      let reason: ScanFailureReason = 'AI_UNAVAILABLE';
      if (e instanceof ExtractorError) reason = e.reason;
      else this.logger.error('Đọc hóa đơn gặp lỗi không lường trước', e instanceof Error ? e.stack : undefined);
      outcome = { mode: 'MANUAL', reason, message: FAILURE_MESSAGES[reason] };
    }
    const latencyMs = Math.round(performance.now() - started);

    const row = await this.prisma.receiptScan.create({
      data: {
        houseId: m.houseId,
        scannedById: m.userId,
        imageUrl: url,
        status: outcome.mode === 'DRAFT' ? 'DRAFT' : 'FAILED',
        failureReason: outcome.mode === 'MANUAL' ? outcome.reason : null,
        // JSON nguyên bản của AI (kể cả khi bị hậu kiểm từ chối) để debug và đánh giá độ chính xác trong báo cáo.
        ...(raw ? { draftJson: raw as unknown as Prisma.InputJsonValue } : {}),
        model: this.config.get('GEMINI_MODEL', { infer: true }) ?? null,
        latencyMs,
      },
    });

    return outcome.mode === 'DRAFT'
      ? { scanId: row.id, imageUrl: url, latencyMs, mode: 'DRAFT', reason: null, message: null, draft: outcome.draft }
      : { scanId: row.id, imageUrl: url, latencyMs, mode: 'MANUAL', reason: outcome.reason, message: outcome.message, draft: null };
  }

  private async assertConsent(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { ocrConsentAt: true } });
    if (!user?.ocrConsentAt) {
      throw coded(HttpStatus.FORBIDDEN, 'OCR_CONSENT_REQUIRED', 'Bạn chưa đồng ý gửi ảnh hóa đơn tới Google Gemini để đọc.');
    }
  }

  /** Mỗi dòng ReceiptScan là một lần gọi Gemini (kể cả lỗi), nên đếm dòng của nhà trong ngày giờ VN. */
  private async assertQuota(houseId: string, now: Date) {
    const used = await this.prisma.receiptScan.count({ where: { houseId, createdAt: { gte: vnDayStart(now) } } });
    if (used >= DAILY_SCAN_LIMIT) {
      throw coded(
        HttpStatus.TOO_MANY_REQUESTS,
        'OCR_QUOTA_EXCEEDED',
        'Nhà bạn đã dùng hết ' + DAILY_SCAN_LIMIT + ' lượt quét hôm nay. Bạn nhập tay nhé, mai quét tiếp.',
      );
    }
  }
}

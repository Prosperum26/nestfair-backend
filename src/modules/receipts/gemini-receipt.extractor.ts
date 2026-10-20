import type { GoogleGenAI } from '@google/genai';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { ExtractorError, type RawReceipt, type ReceiptExtractor, type ReceiptImage } from './receipt-extractor.js';
import { parseRawReceipt, RECEIPT_SYSTEM_PROMPT, receiptResponseSchema } from './receipt-schema.js';

/** Provider của client Gemini; `null` khi chưa có `GEMINI_API_KEY` (OCR tắt, quét trả về nhập tay). */
export const GENAI_CLIENT = Symbol('GENAI_CLIENT');
export type GenAiLike = Pick<GoogleGenAI, 'models'>;

/** Đặc tả XI.13: Gemini quá 10 giây thì bỏ, chuyển nhập tay. */
export const OCR_TIMEOUT_MS = 10_000;

const isAbort = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');

/**
 * Đọc hóa đơn bằng Gemini Vision, luôn ở chế độ JSON + `responseSchema`. Model lấy từ env, không hardcode.
 * Mọi lỗi đều thành `ExtractorError` có mã lý do; chi tiết lỗi của Google chỉ nằm ở `cause` để ghi log.
 */
@Injectable()
export class GeminiReceiptExtractor implements ReceiptExtractor {
  private readonly logger = new Logger(GeminiReceiptExtractor.name);

  constructor(
    @Inject(GENAI_CLIENT) private readonly client: GenAiLike | null,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async extract(image: ReceiptImage): Promise<RawReceipt> {
    const model = this.config.get('GEMINI_MODEL', { infer: true });
    if (!this.client || !model) throw new ExtractorError('AI_UNAVAILABLE');

    const signal = AbortSignal.timeout(OCR_TIMEOUT_MS);
    const started = performance.now();
    let text: string | undefined;
    try {
      const res = await this.client.models.generateContent({
        model,
        contents: [{ inlineData: { mimeType: image.mimeType, data: image.buffer.toString('base64') } }, { text: 'Trích xuất hóa đơn trong ảnh.' }],
        config: {
          systemInstruction: RECEIPT_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: receiptResponseSchema,
          abortSignal: signal,
        },
      });
      text = res.text;
    } catch (e) {
      const reason = signal.aborted || isAbort(e) ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE';
      this.logger.warn('Gemini ' + model + ' lỗi sau ' + Math.round(performance.now() - started) + 'ms: ' + reason + ' (' + (e instanceof Error ? e.message : 'unknown') + ')');
      throw new ExtractorError(reason, { cause: e });
    }

    this.logger.log('Gemini ' + model + ' trả lời sau ' + Math.round(performance.now() - started) + 'ms');
    if (!text) throw new ExtractorError('UNREADABLE');
    return parseRawReceipt(text);
  }
}

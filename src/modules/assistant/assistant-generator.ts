import { Inject, Injectable, Logger } from '@nestjs/common';
// Import giá trị (không phải type-only): Nest cần metadata kiểu của tham số constructor để inject.
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { GENAI_CLIENT, type GenAiLike } from '../receipts/gemini-receipt.extractor.js';
import { type AssistantContext } from './assistant-context.js';
import { AssistantGenError, assistantResponseSchema, type RawAssistantReply, parseAssistantReply } from './assistant-schema.js';

/**
 * Nguồn sinh câu trả lời của Trợ lý. Bản Gemini là mặc định; e2e test thay bằng bản giả qua
 * `overrideProvider(ASSISTANT_GENERATOR)` (quyết định D3). Service không biết tới Gemini.
 */
export const ASSISTANT_GENERATOR = Symbol('ASSISTANT_GENERATOR');

export interface AssistantGenerator {
  generate(ctx: AssistantContext): Promise<RawAssistantReply>;
}

/** Đặc tả VI.5 / D10: Gemini quá 10 giây thì bỏ, trả tin dự phòng. */
export const ASSISTANT_TIMEOUT_MS = 10_000;

const isAbort = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');

/**
 * Sinh câu trả lời bằng Gemini, luôn ở chế độ JSON + `responseSchema` (AGENTS.md mục 4).
 * Model lấy từ env `GEMINI_MODEL`, không hardcode. Mọi lỗi đều thành `AssistantGenError` có mã lý do;
 * chi tiết lỗi của Google chỉ nằm ở `cause` và log server-side, không bao giờ ra client.
 */
@Injectable()
export class GeminiAssistantGenerator implements AssistantGenerator {
  private readonly logger = new Logger(GeminiAssistantGenerator.name);

  constructor(
    @Inject(GENAI_CLIENT) private readonly client: GenAiLike | null,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async generate(ctx: AssistantContext): Promise<RawAssistantReply> {
    const model = this.config.get('GEMINI_MODEL', { infer: true });
    if (!this.client || !model) throw new AssistantGenError('UNAVAILABLE');

    const signal = AbortSignal.timeout(ASSISTANT_TIMEOUT_MS);
    const started = performance.now();
    let text: string | undefined;
    try {
      const res = await this.client.models.generateContent({
        model,
        contents: ctx.contents,
        config: {
          systemInstruction: ctx.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: assistantResponseSchema,
          abortSignal: signal,
        },
      });
      text = res.text;
    } catch (e) {
      const reason = signal.aborted || isAbort(e) ? 'TIMEOUT' : 'UNAVAILABLE';
      this.logger.warn('Gemini ' + model + ' lỗi sau ' + Math.round(performance.now() - started) + 'ms: ' + reason + ' (' + (e instanceof Error ? e.message : 'unknown') + ')');
      throw new AssistantGenError(reason, { cause: e });
    }

    this.logger.log('Gemini ' + model + ' trả lời sau ' + Math.round(performance.now() - started) + 'ms');
    if (!text) throw new AssistantGenError('UNREADABLE');
    return parseAssistantReply(text);
  }
}

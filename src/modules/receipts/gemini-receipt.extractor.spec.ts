import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { GeminiReceiptExtractor, type GenAiLike, OCR_TIMEOUT_MS } from './gemini-receipt.extractor.js';
import { ExtractorError } from './receipt-extractor.js';
import { receiptResponseSchema } from './receipt-schema.js';

const MODEL = 'gemini-test-model';
const config = (over: Record<string, string | undefined> = {}) =>
  ({ get: (key: string) => ({ GEMINI_MODEL: MODEL, ...over })[key] }) as unknown as ConfigService<never, true>;

const IMAGE = { buffer: Buffer.from('anh-hoa-don'), mimeType: 'image/jpeg' };
const GOOD_JSON = JSON.stringify({
  merchant: 'Circle K',
  purchasedAt: '2026-10-06',
  items: [{ name: 'Nước suối', quantity: 2, lineTotal: 12_000 }],
  total: 12_000,
  warnings: [],
});

const clientReturning = (text: string | undefined) => {
  const generateContent = vi.fn().mockResolvedValue({ text });
  return { client: { models: { generateContent } } as unknown as GenAiLike, generateContent };
};
const clientRejecting = (error: unknown) => {
  const generateContent = vi.fn().mockRejectedValue(error);
  return { client: { models: { generateContent } } as unknown as GenAiLike, generateContent };
};
const reasonOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ExtractorError);
    return (e as ExtractorError).reason;
  }
  throw new Error('mong đợi ném ExtractorError');
};

describe('GeminiReceiptExtractor', () => {
  it('gọi Gemini đúng cách: model từ env, JSON + responseSchema, timeout 10s, ảnh gửi dạng inlineData base64', async () => {
    const { client, generateContent } = clientReturning(GOOD_JSON);
    const raw = await new GeminiReceiptExtractor(client, config()).extract(IMAGE);

    expect(raw).toMatchObject({ merchant: 'Circle K', purchasedAt: '2026-10-06', total: 12_000 });
    expect(generateContent).toHaveBeenCalledTimes(1);
    const arg = generateContent.mock.calls[0][0];
    expect(arg.model).toBe(MODEL);
    expect(arg.config.responseMimeType).toBe('application/json');
    expect(arg.config.responseSchema).toBe(receiptResponseSchema);
    expect(arg.config.systemInstruction).toContain('Không tách thuế VAT');
    expect(arg.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(OCR_TIMEOUT_MS).toBe(10_000);
    expect(JSON.stringify(arg.contents)).toContain(IMAGE.buffer.toString('base64'));
    expect(JSON.stringify(arg.contents)).toContain('image/jpeg');
  });

  it('chưa cấu hình (client null hoặc thiếu GEMINI_MODEL) → AI_UNAVAILABLE, không gọi mạng', async () => {
    expect(await reasonOf(new GeminiReceiptExtractor(null, config()).extract(IMAGE))).toBe('AI_UNAVAILABLE');
    const { client, generateContent } = clientReturning(GOOD_JSON);
    expect(await reasonOf(new GeminiReceiptExtractor(client, config({ GEMINI_MODEL: undefined })).extract(IMAGE))).toBe('AI_UNAVAILABLE');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('quá thời gian (AbortError / TimeoutError) → AI_TIMEOUT', async () => {
    for (const error of [new DOMException('This operation was aborted', 'AbortError'), new DOMException('timed out', 'TimeoutError')]) {
      const { client } = clientRejecting(error);
      expect(await reasonOf(new GeminiReceiptExtractor(client, config()).extract(IMAGE))).toBe('AI_TIMEOUT');
    }
  });

  it('Gemini lỗi 429 / 500 / 503 hoặc rớt mạng → AI_UNAVAILABLE', async () => {
    for (const error of [Object.assign(new Error('quota'), { status: 429 }), Object.assign(new Error('x'), { status: 500 }), Object.assign(new Error('high demand'), { status: 503 }), new TypeError('fetch failed')]) {
      const { client } = clientRejecting(error);
      expect(await reasonOf(new GeminiReceiptExtractor(client, config()).extract(IMAGE))).toBe('AI_UNAVAILABLE');
    }
  });

  it('không có văn bản trả về (bị chặn nội dung) hoặc JSON hỏng → UNREADABLE', async () => {
    expect(await reasonOf(new GeminiReceiptExtractor(clientReturning(undefined).client, config()).extract(IMAGE))).toBe('UNREADABLE');
    expect(await reasonOf(new GeminiReceiptExtractor(clientReturning('xin lỗi, mình không đọc được').client, config()).extract(IMAGE))).toBe('UNREADABLE');
    expect(await reasonOf(new GeminiReceiptExtractor(clientReturning('{"items":"abc","total":1}').client, config()).extract(IMAGE))).toBe('UNREADABLE');
  });

  it('chi tiết lỗi gốc của Google không lọt vào thông điệp (chỉ nằm ở cause)', async () => {
    const secret = 'projects/12345/locations/us: API key abc-SECRET invalid';
    const { client } = clientRejecting(Object.assign(new Error(secret), { status: 403 }));
    const err = await new GeminiReceiptExtractor(client, config()).extract(IMAGE).catch((e: unknown) => e as ExtractorError);
    expect(err).toBeInstanceOf(ExtractorError);
    expect((err as ExtractorError).message).toBe('AI_UNAVAILABLE');
    expect(JSON.stringify(err)).not.toContain('SECRET');
    expect(((err as ExtractorError).cause as Error).message).toBe(secret);
  });
});

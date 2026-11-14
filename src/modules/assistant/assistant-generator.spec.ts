import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { buildAssistantContext, type AssistantContextInput } from './assistant-context.js';
import { GeminiAssistantGenerator } from './assistant-generator.js';
import { AssistantGenError } from './assistant-schema.js';

describe('GeminiAssistantGenerator: ánh xạ lỗi không bao giờ lộ provider ra client', () => {
  const ctx = buildAssistantContext({
    house: { name: 'Nhà 12A', rules: null, memberCount: 3 },
    now: new Date('2026-10-25T10:00:00Z'),
    shifts: [],
    history: [],
    question: 'Bồn cầu nghẹt, làm sao?',
  } satisfies AssistantContextInput);

  const make = (client: unknown, model?: string) => {
    const config = { get: (key: string) => (key === 'GEMINI_MODEL' ? model : undefined) };
    return new GeminiAssistantGenerator(client as never, config as unknown as ConfigService<Env, true>);
  };

  it('chưa cấu hình client hoặc model → UNAVAILABLE, không gọi provider', async () => {
    const gen = vi.fn();
    await expect(make(null, 'gemini-test').generate(ctx)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(make({ models: { generateContent: gen } }, undefined).generate(ctx)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(gen).not.toHaveBeenCalled();
  });

  it('lỗi provider → UNAVAILABLE, thông điệp lỗi chỉ là mã lý do, chi tiết nằm trong cause', async () => {
    const boom = new Error('API key abc-SECRET revoked');
    const gen = vi.fn().mockRejectedValue(boom);
    const err = await make({ models: { generateContent: gen } }, 'gemini-test').generate(ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AssistantGenError);
    expect((err as AssistantGenError).code).toBe('UNAVAILABLE');
    expect((err as AssistantGenError).message).toBe('UNAVAILABLE');
    expect((err as AssistantGenError).cause).toBe(boom);
  });

  it('hết giờ (AbortError) → TIMEOUT', async () => {
    const abort = new Error('This operation was aborted');
    abort.name = 'AbortError';
    const gen = vi.fn().mockRejectedValue(abort);
    const err = await make({ models: { generateContent: gen } }, 'gemini-test').generate(ctx).catch((e: unknown) => e);
    expect((err as AssistantGenError).code).toBe('TIMEOUT');
  });

  it('trả về rỗng hoặc sai cấu trúc JSON → UNREADABLE; JSON đúng thì parse thành RawAssistantReply', async () => {
    const ok = vi.fn().mockResolvedValue({ text: JSON.stringify({ reply: 'Được chứ.', category: 'TIP', suggestedActions: [] }) });
    const gen = make({ models: { generateContent: ok } }, 'gemini-test');
    await expect(gen.generate(ctx)).resolves.toEqual({ reply: 'Được chứ.', category: 'TIP', suggestedActions: [] });

    const empty = make({ models: { generateContent: vi.fn().mockResolvedValue({ text: undefined }) } }, 'gemini-test');
    await expect(empty.generate(ctx)).rejects.toMatchObject({ code: 'UNREADABLE' });

    const garbage = make({ models: { generateContent: vi.fn().mockResolvedValue({ text: 'không phải json' }) } }, 'gemini-test');
    await expect(garbage.generate(ctx)).rejects.toMatchObject({ code: 'UNREADABLE' });
  });

  it('gọi Gemini đúng tham số: model từ env, JSON + responseSchema, systemInstruction + contents từ ctx', async () => {
    const gen = vi.fn().mockResolvedValue({ text: JSON.stringify({ reply: 'Ok', category: 'OTHER', suggestedActions: [] }) });
    await make({ models: { generateContent: gen } }, 'gemini-2.5-flash').generate(ctx);
    expect(gen).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        contents: ctx.contents,
        config: expect.objectContaining({
          systemInstruction: ctx.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: expect.anything(),
          abortSignal: expect.any(AbortSignal),
        }),
      }),
    );
  });
});

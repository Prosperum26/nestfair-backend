import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  JWT_SECRET: 'x'.repeat(64),
};

describe('validateEnv: Gemini (OCR hóa đơn)', () => {
  it('có GEMINI_API_KEY mà thiếu GEMINI_MODEL thì dừng ngay và nhắc GEMINI_MODEL', () => {
    expect(() => validateEnv({ ...base, GEMINI_API_KEY: 'key' })).toThrow(/GEMINI_MODEL/);
  });

  it('có cả key và model thì hợp lệ', () => {
    const env = validateEnv({ ...base, GEMINI_API_KEY: 'key', GEMINI_MODEL: 'gemini-3.5-flash-lite' });
    expect(env.GEMINI_API_KEY).toBe('key');
    expect(env.GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
  });

  it('không có key thì hợp lệ (OCR tắt, quét trả về nhập tay)', () => {
    const env = validateEnv(base);
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GEMINI_MODEL).toBeUndefined();
  });
});

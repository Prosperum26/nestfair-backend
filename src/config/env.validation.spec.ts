import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { getMetadataStorage } from 'class-validator';
import { readFileSync } from 'node:fs';
import { Env, validateEnv } from './env.validation.js';

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

describe('.env.example đồng bộ với Env', () => {
  // Biến khai báo trong Env (theo metadata class-validator), so với biến có trong .env.example
  // (kể cả dòng đã comment kiểu `# TÊN=giá trị`, vì biến tùy chọn được ghi dưới dạng gợi ý).
  const declared = [
    ...new Set(
      getMetadataStorage()
        .getTargetValidationMetadatas(Env, '', false, false)
        .map((m) => m.propertyName),
    ),
  ];
  const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

  it('đọc được danh sách biến từ Env', () => {
    expect(declared).toEqual(expect.arrayContaining(['DATABASE_URL', 'JWT_SECRET', 'TRUST_PROXY_HOPS']));
  });

  it('mọi biến của Env đều có trong .env.example', () => {
    expect(declared.filter((k) => !documented.has(k))).toEqual([]);
  });
});

import { randomInt } from 'node:crypto';

/** 62 ký tự theo thứ tự 0-9A-Za-z. 62^8 ≈ 2,2e14 tin, trùng thì thử lại ở service. */
export const SLUG_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const SLUG_LENGTH = 8;

const SLUG_PATTERN = /^[0-9A-Za-z]{8}$/;

/** Lấy từng ký tự bằng `rand(62)` (mặc định `crypto.randomInt`, không lệch modulo). */
export function generateSlug(rand: (max: number) => number = randomInt): string {
  let slug = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += SLUG_ALPHABET[rand(SLUG_ALPHABET.length)];
  }
  return slug;
}

export function isValidSlug(s: string): boolean {
  return SLUG_PATTERN.test(s);
}

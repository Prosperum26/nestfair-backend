import { randomInt } from 'node:crypto';

/** Bỏ 0/O, 1/I để đọc qua điện thoại hay chép tay không nhầm. 32 ký tự → 32^6 ≈ 1,07 tỷ mã. */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 6;
export const INVITE_TTL_DAYS = 7;

export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return code;
}

/** Người dùng gõ " k7m 2qz " → "K7M2QZ" (không phân biệt hoa thường, bỏ khoảng trắng/gạch). */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 86_400_000);
}

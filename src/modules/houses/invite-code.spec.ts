import {
  generateInviteCode,
  INVITE_ALPHABET,
  inviteExpiry,
  normalizeInviteCode,
} from './invite-code.js';

describe('invite code', () => {
  it('sinh đúng 6 ký tự, chỉ dùng bảng chữ cho phép', () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(INVITE_ALPHABET).toContain(ch);
    }
  });

  it('không chứa ký tự dễ nhầm 0, O, 1, I', () => {
    expect(INVITE_ALPHABET).not.toMatch(/[0O1I]/);
    expect(new Set(INVITE_ALPHABET).size).toBe(INVITE_ALPHABET.length);
  });

  it('ngẫu nhiên: 1000 mã gần như không trùng', () => {
    const codes = new Set(Array.from({ length: 1000 }, generateInviteCode));
    expect(codes.size).toBeGreaterThan(995);
  });

  it.each([
    [' k7m2qz ', 'K7M2QZ'],
    ['K7M 2QZ', 'K7M2QZ'],
    ['k7m-2qz', 'K7M2QZ'],
  ])('chuẩn hóa "%s" → %s', (input, expected) => {
    expect(normalizeInviteCode(input)).toBe(expected);
  });

  it('hết hạn sau 7 ngày', () => {
    const now = new Date('2026-10-08T00:00:00Z');
    expect(inviteExpiry(now).toISOString()).toBe('2026-10-15T00:00:00.000Z');
  });
});

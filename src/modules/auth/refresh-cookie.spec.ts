import { refreshCookieOptions } from './refresh-cookie.js';

describe('refreshCookieOptions', () => {
  it('máy dev: lax, không secure (localhost chạy http)', () => {
    expect(refreshCookieOptions('development')).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false, path: '/api/v1/auth' });
  });

  it('production mặc định: none + secure (FE và BE khác site)', () => {
    expect(refreshCookieOptions('production')).toMatchObject({ sameSite: 'none', secure: true });
  });

  it('production cùng tên miền: COOKIE_SAME_SITE=lax, vẫn secure', () => {
    expect(refreshCookieOptions('production', 'lax')).toMatchObject({ sameSite: 'lax', secure: true });
  });

  it('sameSite=none luôn kèm secure, kể cả ngoài production (trình duyệt bắt buộc)', () => {
    expect(refreshCookieOptions('development', 'none')).toMatchObject({ sameSite: 'none', secure: true });
  });
});

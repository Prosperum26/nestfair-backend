import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';

// Key giả: đủ để kiểm tra luồng chuyển hướng + state, không gọi Google thật.
// Đặt trước khi import AppModule vì ConfigModule.forRoot đọc env ngay lúc import.
process.env.GOOGLE_CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'fake-secret';
process.env.GOOGLE_CALLBACK_URL =
  'http://localhost:5000/api/v1/auth/google/callback';
process.env.PUBLIC_WEB_URL = 'http://localhost:5173';

const WEB_CALLBACK = 'http://localhost:5173/auth/callback';

function stateCookie(res: request.Response): string | undefined {
  return ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('nf_oauth_state='));
}

describe('Google OAuth khi có key (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const { configureApp } = await import('../src/app.setup.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('GET /auth/config trả googleEnabled = true', async () => {
    await http()
      .get('/api/v1/auth/config')
      .expect(200)
      .expect({ googleEnabled: true });
  });

  it('GET /auth/google chuyển hướng sang Google kèm state khớp cookie httpOnly', async () => {
    const res = await http().get('/api/v1/auth/google').expect(302);

    const location = new URL(res.headers.location);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe(
      process.env.GOOGLE_CLIENT_ID,
    );
    expect(location.searchParams.get('redirect_uri')).toBe(
      process.env.GOOGLE_CALLBACK_URL,
    );
    expect(location.searchParams.get('scope')).toBe('email profile');
    expect(location.searchParams.get('prompt')).toBe('select_account');

    const state = location.searchParams.get('state');
    expect(state).toMatch(/^[\w-]{20,}$/);
    const cookie = stateCookie(res);
    expect(cookie).toContain(`nf_oauth_state=${state}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth\/google/);
  });

  it('mỗi lần bắt đầu sinh state khác nhau', async () => {
    const a = await http().get('/api/v1/auth/google');
    const b = await http().get('/api/v1/auth/google');
    expect(stateCookie(a)).not.toBe(stateCookie(b));
  });

  it.each([
    ['không có cookie state', '?code=abc&state=xyz', undefined],
    [
      'state không khớp cookie (login CSRF)',
      '?code=abc&state=xyz',
      'nf_oauth_state=khac',
    ],
    [
      'người dùng bấm hủy ở Google',
      '?error=access_denied&state=s1',
      'nf_oauth_state=s1',
    ],
  ])(
    'callback %s thì về trang web kèm ?error, không cấp phiên',
    async (_, query, cookie) => {
      const req = http().get(`/api/v1/auth/google/callback${query}`);
      if (cookie) req.set('Cookie', cookie);
      const res = await req.expect(302);

      expect(res.headers.location).toBe(`${WEB_CALLBACK}?error=google_failed`);
      const setCookies = ([] as string[]).concat(
        res.headers['set-cookie'] ?? [],
      );
      expect(
        setCookies.some(
          (c) => c.startsWith('nf_rt=') && !/Expires=Thu, 01 Jan 1970/.test(c),
        ),
      ).toBe(false);
    },
  );
});

import { createFixture } from './support/house-fixture.js';

const DOMAIN = '@csrf.test';
const GOOD = 'http://localhost:5173'; // CORS_ORIGINS mặc định khi test
const EVIL = 'https://nestfair.evil.example';

/**
 * Cookie refresh dùng sameSite=none khi FE và BE khác site, nên trang lạ có thể gửi kèm cookie.
 * Route dùng cookie (refresh, logout) chỉ nhận Origin nằm trong CORS_ORIGINS.
 */
describe('Chống CSRF ở route dùng cookie refresh', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const http = () => fx.http();

  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  async function sessionCookie(): Promise<string> {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Thử', email: `c${Date.now()}${DOMAIN}`, phone: '0901234567', password: 'MatKhau123' })
      .expect(201);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('nf_rt='));
    expect(cookie).toBeDefined();
    return cookie!.split(';')[0];
  }

  it('refresh từ origin lạ: 403 ORIGIN_NOT_ALLOWED, không cấp token', async () => {
    const cookie = await sessionCookie();
    const res = await http().post('/api/v1/auth/refresh').set('Origin', EVIL).set('Cookie', cookie).expect(403);
    expect(res.body).toMatchObject({ statusCode: 403, code: 'ORIGIN_NOT_ALLOWED' });
    expect(res.body.accessToken).toBeUndefined();
    // Cookie vẫn dùng được từ origin hợp lệ (bị chặn trước khi xoay vòng).
    await http().post('/api/v1/auth/refresh').set('Origin', GOOD).set('Cookie', cookie).expect(200);
  });

  it('logout từ origin lạ: 403, phiên không bị thu hồi', async () => {
    const cookie = await sessionCookie();
    await http().post('/api/v1/auth/logout').set('Origin', EVIL).set('Cookie', cookie).expect(403);
    await http().post('/api/v1/auth/refresh').set('Origin', GOOD).set('Cookie', cookie).expect(200);
  });

  it('origin "null" (iframe sandbox, file://) cũng bị chặn', async () => {
    const cookie = await sessionCookie();
    await http().post('/api/v1/auth/refresh').set('Origin', 'null').set('Cookie', cookie).expect(403);
  });

  it('không có Origin (client không phải trình duyệt) thì xử lý bình thường', async () => {
    const cookie = await sessionCookie();
    await http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200);
  });
});

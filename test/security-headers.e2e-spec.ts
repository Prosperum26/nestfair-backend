import { createFixture } from './support/house-fixture.js';

describe('Header bảo mật và giới hạn body', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let token: string;

  beforeAll(async () => {
    fx = await createFixture('@headers.test');
    token = (await fx.user('Thử')).token;
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('dữ liệu riêng (hồ sơ, thông báo) không được cache ở trình duyệt hay proxy', async () => {
    for (const path of ['/api/v1/auth/me', '/api/v1/notifications']) {
      const res = await fx.as(token).get(path).expect(200);
      expect(res.headers['cache-control'], path).toBe('no-store');
    }
  });

  it('lỗi cũng không cache', async () => {
    const res = await fx.http().get('/api/v1/auth/me').expect(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('Helmet: nosniff, chặn nhúng iframe, HSTS, không lộ x-powered-by', async () => {
    const res = await fx.http().get('/api/v1/auth/config').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('body JSON quá 100kb: 413, không xử lý', async () => {
    const big = { title: 'x'.repeat(110 * 1024) };
    await fx.as(token).post('/api/v1/reminders', big).expect(413);
  });

  it('JSON hỏng: 400 đúng format, không 500', async () => {
    const res = await fx
      .http()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(res.body).toMatchObject({ statusCode: 400 });
  });
});

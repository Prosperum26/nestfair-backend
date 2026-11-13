import { createFixture } from './support/house-fixture.js';

const DOMAIN = '@lockout.test';

describe('Khóa tạm đăng nhập theo email', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const http = () => fx.http();

  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  async function register(tag: string) {
    const email = `${tag}${Date.now()}${DOMAIN}`;
    await http()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Thử', email, phone: '0901234567', password: 'MatKhau123' })
      .expect(201);
    return email;
  }

  it('sai 5 lần thì lần sau (kể cả đúng mật khẩu) bị 429 LOGIN_LOCKED; email khác vẫn đăng nhập được', async () => {
    const victim = await register('victim');
    const other = await register('other');
    for (let i = 0; i < 5; i++) {
      await http().post('/api/v1/auth/login').send({ email: victim, password: 'SaiMatKhau1' }).expect(401);
    }
    const res = await http().post('/api/v1/auth/login').send({ email: victim, password: 'MatKhau123' }).expect(429);
    expect(res.body).toMatchObject({ statusCode: 429, code: 'LOGIN_LOCKED' });
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    await http().post('/api/v1/auth/login').send({ email: other, password: 'MatKhau123' }).expect(200);
  });

  it('email không tồn tại cũng bị khóa như thật, không lộ tài khoản nào có thật', async () => {
    const ghost = `ghost${Date.now()}${DOMAIN}`;
    for (let i = 0; i < 5; i++) {
      await http().post('/api/v1/auth/login').send({ email: ghost, password: 'SaiMatKhau1' }).expect(401);
    }
    const res = await http().post('/api/v1/auth/login').send({ email: ghost, password: 'SaiMatKhau1' }).expect(429);
    expect(res.body.code).toBe('LOGIN_LOCKED');
  });

  it('đăng nhập đúng trước khi đủ 5 lần thì xóa bộ đếm', async () => {
    const email = await register('reset');
    for (let i = 0; i < 4; i++) {
      await http().post('/api/v1/auth/login').send({ email, password: 'SaiMatKhau1' }).expect(401);
    }
    await http().post('/api/v1/auth/login').send({ email, password: 'MatKhau123' }).expect(200);
    for (let i = 0; i < 4; i++) {
      await http().post('/api/v1/auth/login').send({ email, password: 'SaiMatKhau1' }).expect(401);
    }
    await http().post('/api/v1/auth/login').send({ email, password: 'MatKhau123' }).expect(200);
  });
});

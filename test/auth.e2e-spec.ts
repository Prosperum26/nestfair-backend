import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Cần Postgres đang chạy (npm run db:up) và .env hợp lệ.
const DOMAIN = '@e2e.nestfair.test';
let seq = 0;
const email = (name: string) => `${name}-${Date.now()}-${seq++}${DOMAIN}`;
const valid = (over: Record<string, unknown> = {}) => ({
  fullName: 'Trần Minh Hùng',
  email: email('hung'),
  phone: '0901 234 567',
  password: 'MatKhau123',
  ...over,
});

function refreshCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('nf_rt='));
  if (!cookie) throw new Error('Không có cookie nf_rt');
  return cookie;
}
const cookiePair = (setCookie: string) => setCookie.split(';')[0];

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('POST /auth/register', () => {
    it('tạo tài khoản, trả access token + cookie httpOnly, không lộ mật khẩu', async () => {
      const body = valid();
      const res = await http()
        .post('/api/v1/auth/register')
        .send(body)
        .expect(201);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({
        email: body.email,
        fullName: 'Trần Minh Hùng',
        phone: '0901234567',
      });
      expect(JSON.stringify(res.body)).not.toMatch(
        /password|MatKhau123|googleId/i,
      );

      const cookie = refreshCookie(res);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(cookie).toMatch(/Expires=/);

      const row = await prisma.user.findUniqueOrThrow({
        where: { email: body.email },
      });
      expect(row.passwordHash).toMatch(/^\$2b\$10\$/);
    });

    it('email trùng (khác hoa/thường) thì 409', async () => {
      const body = valid();
      await http().post('/api/v1/auth/register').send(body).expect(201);

      const res = await http()
        .post('/api/v1/auth/register')
        .send({ ...body, email: body.email.toUpperCase() })
        .expect(409);
      expect(res.body.message).toBe(
        'Email này đã được dùng. Bạn muốn đăng nhập?',
      );
    });

    it.each([
      ['email sai', { email: 'khong-phai-email' }],
      ['mật khẩu ngắn', { password: 'Ab1' }],
      ['mật khẩu thiếu chữ hoa', { password: 'matkhau123' }],
      ['mật khẩu thiếu số', { password: 'MatKhauDai' }],
      ['SĐT sai', { phone: '12345' }],
      ['thiếu họ tên', { fullName: '' }],
      ['gửi thêm field lạ', { role: 'ADMIN' }],
    ])('%s thì 400', async (_, over) => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send(valid(over))
        .expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
    });
  });

  describe('POST /auth/login', () => {
    const account = valid({ email: email('login') });
    beforeAll(async () => {
      await http().post('/api/v1/auth/register').send(account).expect(201);
    });

    it('đúng thông tin thì 200 + cookie', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);
      expect(res.body.user.email).toBe(account.email);
      refreshCookie(res);
    });

    it('rememberMe = false thì cookie phiên (không có Expires)', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({
          email: account.email,
          password: account.password,
          rememberMe: false,
        })
        .expect(200);
      expect(refreshCookie(res)).not.toMatch(/Expires=/);
    });

    it.each([
      [
        'sai mật khẩu',
        () => ({ email: account.email, password: 'SaiMatKhau1' }),
      ],
      [
        'email không tồn tại',
        () => ({ email: email('ghost'), password: 'MatKhau123' }),
      ],
    ])('%s thì 401 cùng thông báo', async (_, payload) => {
      const res = await http()
        .post('/api/v1/auth/login')
        .send(payload())
        .expect(401);
      expect(res.body.message).toBe('Email hoặc mật khẩu không đúng.');
    });
  });

  describe('phiên đăng nhập: me / refresh / logout', () => {
    it('GET /auth/me cần JWT hợp lệ', async () => {
      await http().get('/api/v1/auth/me').expect(401);
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer rac')
        .expect(401);
    });

    it('luồng đầy đủ: register → me → refresh xoay vòng → token cũ bị từ chối → logout', async () => {
      const reg = await http()
        .post('/api/v1/auth/register')
        .send(valid())
        .expect(201);
      const firstCookie = cookiePair(refreshCookie(reg));

      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${reg.body.accessToken}`)
        .expect(200);
      expect(me.body.id).toBe(reg.body.user.id);

      const refreshed = await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', firstCookie)
        .expect(200);
      const secondCookie = cookiePair(refreshCookie(refreshed));
      expect(secondCookie).not.toBe(firstCookie);
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
        .expect(200);

      // Dùng lại token đã xoay vòng thì bị từ chối.
      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', firstCookie)
        .expect(401);

      await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', secondCookie)
        .expect(204);
      await http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', secondCookie)
        .expect(401);
    });

    it('refresh không có cookie thì 401', async () => {
      await http().post('/api/v1/auth/refresh').expect(401);
    });
  });
});

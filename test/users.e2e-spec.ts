import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Cần Postgres đang chạy (npm run db:up) và .env hợp lệ.
const DOMAIN = '@e2e-users.nestfair.test';

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Lê Đức Thiện',
        email: `thien-${Date.now()}${DOMAIN}`,
        phone: '0912345678',
        password: 'MatKhau123',
      })
      .expect(201);
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await app.close();
  });

  const patch = (body: object) =>
    request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('cần JWT', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .send({})
      .expect(401);
  });

  it('GET trả hồ sơ, không có passwordHash', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.fullName).toBe('Lê Đức Thiện');
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('lưu tài khoản nhận tiền (bỏ khoảng trắng trong STK)', async () => {
    const res = await patch({
      bankBin: '970436',
      bankAccount: '0071 0004 4456',
    }).expect(200);
    expect(res.body).toMatchObject({
      bankBin: '970436',
      bankAccount: '007100044456',
    });
  });

  it('xóa tài khoản nhận tiền bằng null', async () => {
    const res = await patch({ bankBin: null, bankAccount: null }).expect(200);
    expect(res.body).toMatchObject({ bankBin: null, bankAccount: null });
  });

  it.each([
    ['chỉ gửi ngân hàng', { bankBin: '970436' }],
    ['mã BIN sai', { bankBin: '97', bankAccount: '123456' }],
    ['STK có chữ', { bankBin: '970436', bankAccount: 'abc123' }],
    ['họ tên null', { fullName: null }],
    ['đổi email qua route này', { email: 'moi@x.com' }],
    ['đổi mật khẩu qua route này', { password: 'MatKhau456' }],
  ])('%s thì 400', async (_, body) => {
    await patch(body).expect(400);
  });

  describe('đồng ý quét OCR (ocr-consent)', () => {
    const as = (t: string) => ({
      me: () => request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', 'Bearer ' + t),
      consent: (body: object) =>
        request(app.getHttpServer()).patch('/api/v1/users/me/ocr-consent').set('Authorization', 'Bearer ' + t).send(body),
    });

    it('cần JWT', async () => {
      await request(app.getHttpServer()).patch('/api/v1/users/me/ocr-consent').send({ enabled: true }).expect(401);
    });

    it('mặc định chưa đồng ý; bật rồi tắt; chỉ ảnh hưởng chính người đó', async () => {
      const other = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ fullName: 'Người khác', email: 'other-' + Date.now() + DOMAIN, phone: '0912345679', password: 'MatKhau123' })
        .expect(201);
      expect(other.body.user.ocrConsentAt).toBeNull();

      expect((await as(token).me().expect(200)).body.ocrConsentAt).toBeNull();

      const on = await as(token).consent({ enabled: true }).expect(200);
      expect(on.body.ocrConsentAt).toEqual(expect.any(String));
      expect((await as(token).me().expect(200)).body.ocrConsentAt).toBe(on.body.ocrConsentAt);

      // Bật lần nữa không đổi mốc đồng ý đầu tiên.
      const again = await as(token).consent({ enabled: true }).expect(200);
      expect(again.body.ocrConsentAt).toBe(on.body.ocrConsentAt);

      // Người khác không bị kéo theo.
      expect((await as(other.body.accessToken).me().expect(200)).body.ocrConsentAt).toBeNull();

      const off = await as(token).consent({ enabled: false }).expect(200);
      expect(off.body.ocrConsentAt).toBeNull();
      expect((await as(token).me().expect(200)).body.ocrConsentAt).toBeNull();
    });

    it.each([
      ['thiếu enabled', {}],
      ['enabled là chuỗi', { enabled: 'true' }],
      ['enabled là số', { enabled: 1 }],
      ['field lạ', { enabled: true, ocrConsentAt: '2020-01-01T00:00:00Z' }],
    ])('%s thì 400', async (_, body) => {
      await as(token).consent(body).expect(400);
    });
  });

  describe('đồng ý Trợ lý AI (assistant-consent)', () => {
    const as = (t: string) => ({
      me: () => request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', 'Bearer ' + t),
      consent: (body: object) =>
        request(app.getHttpServer()).patch('/api/v1/users/me/assistant-consent').set('Authorization', 'Bearer ' + t).send(body),
    });

    it('cần JWT', async () => {
      await request(app.getHttpServer()).patch('/api/v1/users/me/assistant-consent').send({ enabled: true }).expect(401);
    });

    it('mặc định chưa đồng ý; bật rồi tắt; không đụng mốc ocr; chỉ ảnh hưởng chính người đó', async () => {
      const other = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ fullName: 'Người khác 2', email: 'other2-' + Date.now() + DOMAIN, phone: '0912345670', password: 'MatKhau123' })
        .expect(201);
      expect(other.body.user.assistantConsentAt).toBeNull();

      expect((await as(token).me().expect(200)).body.assistantConsentAt).toBeNull();

      const on = await as(token).consent({ enabled: true }).expect(200);
      expect(on.body.assistantConsentAt).toEqual(expect.any(String));
      expect((await as(token).me().expect(200)).body.assistantConsentAt).toBe(on.body.assistantConsentAt);

      // Bật lần nữa không đổi mốc đồng ý đầu tiên.
      const again = await as(token).consent({ enabled: true }).expect(200);
      expect(again.body.assistantConsentAt).toBe(on.body.assistantConsentAt);

      // Đồng ý trợ lý không tự đồng ý OCR (cột riêng, quyết định D5).
      expect((await as(token).me().expect(200)).body.ocrConsentAt).toBeNull();

      // Người khác không bị kéo theo.
      expect((await as(other.body.accessToken).me().expect(200)).body.assistantConsentAt).toBeNull();

      const off = await as(token).consent({ enabled: false }).expect(200);
      expect(off.body.assistantConsentAt).toBeNull();
      expect((await as(token).me().expect(200)).body.assistantConsentAt).toBeNull();
    });

    it.each([
      ['thiếu enabled', {}],
      ['enabled là chuỗi', { enabled: 'true' }],
      ['enabled là số', { enabled: 1 }],
      ['field lạ', { enabled: true, assistantConsentAt: '2020-01-01T00:00:00Z' }],
    ])('%s thì 400', async (_, body) => {
      await as(token).consent(body).expect(400);
    });
  });

  describe('PATCH /users/me/notifications', () => {
    const notify = (t: string, body: object) =>
      request(app.getHttpServer()).patch('/api/v1/users/me/notifications').set('Authorization', `Bearer ${t}`).send(body);

    it('chưa chỉnh thì notificationPrefs null; chỉ khóa gửi mới đổi, khóa khác giữ nguyên', async () => {
      const me = await request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(me.body.notificationPrefs).toBeNull();

      const first = await notify(token, { choreDigest: false }).expect(200);
      expect(first.body.notificationPrefs).toEqual({ expenseCreated: true, choreDigest: false, debtPaid: true });
      const second = await notify(token, { debtPaid: false }).expect(200);
      expect(second.body.notificationPrefs).toEqual({ expenseCreated: true, choreDigest: false, debtPaid: false });
    });

    it.each([
      ['giá trị là chuỗi', { choreDigest: 'no' }],
      ['khóa lạ', { marketing: true }],
    ])('%s thì 400', async (_, body) => {
      await notify(token, body).expect(400);
    });
  });

  describe('avatar', () => {
    const upload = (t: string) => request(app.getHttpServer()).post('/api/v1/users/me/avatar').set('Authorization', `Bearer ${t}`);

    it('thiếu file thì 400 AVATAR_REQUIRED', async () => {
      const res = await upload(token).expect(400);
      expect(res.body.code).toBe('AVATAR_REQUIRED');
    });

    it('file không phải ảnh jpeg/png/webp thì 415', async () => {
      await upload(token).attach('avatar', Buffer.from('GIF89a....'), { filename: 'a.gif', contentType: 'image/gif' }).expect(415);
    });

    it('xóa khi chưa có avatar vẫn 200', async () => {
      const res = await request(app.getHttpServer()).delete('/api/v1/users/me/avatar').set('Authorization', `Bearer ${token}`).expect(200);
      expect(res.body.avatarUrl).toBeNull();
    });

    it('cần JWT', async () => {
      await request(app.getHttpServer()).post('/api/v1/users/me/avatar').expect(401);
    });
  });
});

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
    await request(app.getHttpServer()).patch('/api/v1/users/me').send({}).expect(401);
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
    const res = await patch({ bankBin: '970436', bankAccount: '0071 0004 4456' }).expect(200);
    expect(res.body).toMatchObject({ bankBin: '970436', bankAccount: '007100044456' });
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
});

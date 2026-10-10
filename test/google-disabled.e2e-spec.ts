import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';

// Ép tắt Google dù .env có key. Phải đặt trước khi import AppModule
// vì ConfigModule.forRoot đọc env ngay lúc import.
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';

describe('Google OAuth khi chưa có key (e2e)', () => {
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

  it('GET /auth/config trả googleEnabled = false', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/config')
      .expect(200)
      .expect({ googleEnabled: false });
  });

  it.each([
    '/api/v1/auth/google',
    '/api/v1/auth/google/callback?code=x&state=y',
  ])('GET %s trả 404', async (path) => {
    await request(app.getHttpServer()).get(path).expect(404);
  });
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { THROTTLE_DEFAULT, throttlerOptions } from '../src/common/throttle/throttle.config.js';

// ConfigModule đọc env lúc import AppModule: vi.hoisted chạy trước mọi import.
vi.hoisted(() => {
  process.env.TRUST_PROXY_HOPS = '1';
});

/**
 * Chạy sau 1 proxy (Render) với TRUST_PROXY_HOPS=1: IP lấy từ X-Forwarded-For,
 * nên mỗi người dùng thật có bộ đếm throttle riêng thay vì dùng chung IP của proxy.
 */
describe('Sau proxy (TRUST_PROXY_HOPS=1)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getOptionsToken())
      .useValue({ ...throttlerOptions, skipIf: () => false })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.TRUST_PROXY_HOPS;
  });

  it('mỗi IP client có bộ đếm riêng', async () => {
    for (let i = 0; i < THROTTLE_DEFAULT.limit; i++) {
      await http().get('/api/v1/auth/config').set('X-Forwarded-For', '198.51.100.1').expect(200);
    }
    await http().get('/api/v1/auth/config').set('X-Forwarded-For', '198.51.100.1').expect(429);
    await http().get('/api/v1/auth/config').set('X-Forwarded-For', '198.51.100.2').expect(200);
  });
});

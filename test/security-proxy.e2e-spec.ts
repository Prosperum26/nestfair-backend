import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';

/**
 * Chạy sau 1 proxy (Render) với TRUST_PROXY_HOPS=1: IP lấy từ X-Forwarded-For,
 * nên mỗi người dùng thật có bộ đếm throttle riêng thay vì dùng chung IP của proxy.
 * Đặt biến môi trường trước khi nạp AppModule (ConfigModule đọc env lúc import).
 */
describe('Sau proxy (TRUST_PROXY_HOPS=1)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.TRUST_PROXY_HOPS = '1';
    const [{ Test }, { getOptionsToken }, { AppModule }, { configureApp }, { throttlerOptions }] = await Promise.all([
      import('@nestjs/testing'),
      import('@nestjs/throttler'),
      import('../src/app.module.js'),
      import('../src/app.setup.js'),
      import('../src/common/throttle/throttle.config.js'),
    ]);
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
    const { THROTTLE_DEFAULT } = await import('../src/common/throttle/throttle.config.js');
    for (let i = 0; i < THROTTLE_DEFAULT.limit; i++) {
      await http().get('/api/v1/auth/config').set('X-Forwarded-For', '198.51.100.1').expect(200);
    }
    await http().get('/api/v1/auth/config').set('X-Forwarded-For', '198.51.100.1').expect(429);
    await http().get('/api/v1/auth/config').set('X-Forwarded-For', '198.51.100.2').expect(200);
  });
});

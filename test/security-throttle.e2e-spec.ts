import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { THROTTLE_DEFAULT, throttlerOptions } from '../src/common/throttle/throttle.config.js';

/**
 * Throttle bị tắt ở các e2e khác (NODE_ENV=test). File này bật lại để kiểm giới hạn thật.
 * Mỗi file e2e có app riêng nên bộ đếm trong bộ nhớ không lẫn với file khác.
 */
describe('Giới hạn tần suất (throttle bật)', () => {
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
    await app.close();
  });

  it(`mặc định toàn cục: ${THROTTLE_DEFAULT.limit} request/phút/IP, request kế tiếp nhận 429 tiếng Việt`, async () => {
    for (let i = 0; i < THROTTLE_DEFAULT.limit; i++) {
      await http().get('/api/v1/auth/config').expect(200);
    }
    const res = await http().get('/api/v1/auth/config').expect(429);
    expect(res.body).toMatchObject({ statusCode: 429 });
    expect(res.body.message).toMatch(/quá nhiều/);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('route ghi đè giữ mức riêng: trang tin công khai 60 request/phút', async () => {
    for (let i = 0; i < 60; i++) {
      await http().get('/api/v1/public/listings/khong-ton-tai').expect(404);
    }
    await http().get('/api/v1/public/listings/khong-ton-tai').expect(429);
  });
});

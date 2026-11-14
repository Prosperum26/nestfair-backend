import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createFixture } from './support/house-fixture.js';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('Access token chỉ nhận HS256', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let user: { id: string; token: string };
  let secret: string;

  beforeAll(async () => {
    fx = await createFixture('@jwt.test');
    user = await fx.user('Thử');
    secret = fx.app.get(ConfigService).get<string>('JWT_SECRET')!;
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it('token hợp lệ của server dùng được', async () => {
    await fx.as(user.token).get('/api/v1/auth/me').expect(200);
  });

  it('ký bằng thuật toán khác (HS512, cùng secret): 401', async () => {
    const forged = new JwtService().sign({ sub: user.id, email: 'x@jwt.test' }, { secret, algorithm: 'HS512', expiresIn: '5m' });
    await fx.as(forged).get('/api/v1/auth/me').expect(401);
  });

  it('alg "none" không chữ ký: 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: user.id, email: 'x@jwt.test', iat: now, exp: now + 300 })}.`;
    await fx.as(forged).get('/api/v1/auth/me').expect(401);
  });
});

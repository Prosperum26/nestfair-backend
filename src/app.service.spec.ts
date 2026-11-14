import { AppService } from './app.service.js';
import type { PrismaService } from './prisma/prisma.service.js';

describe('AppService.live', () => {
  const prisma = {
    $queryRaw: () => {
      throw new Error('live không được chạm DB');
    },
  } as unknown as PrismaService;
  const service = new AppService(prisma);

  it('không chạm DB (pinger gọi 5 phút một lần, không được đánh thức Neon)', () => {
    expect(() => service.live({})).not.toThrow();
  });

  it('trả 7 ký tự đầu của commit Render đang chạy, để workflow biết bản mới đã lên', () => {
    expect(service.live({ RENDER_GIT_COMMIT: '7c924501317867ad07c6a8bdcfb08c8dc7197530' })).toEqual({
      status: 'ok',
      commit: '7c92450',
    });
  });

  it('chạy ngoài Render thì commit là "local"', () => {
    expect(service.live({})).toEqual({ status: 'ok', commit: 'local' });
  });
});

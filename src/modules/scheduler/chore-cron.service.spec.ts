import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditService } from '../chores/audit.service.js';
import type { ScheduleService } from '../chores/schedule.service.js';
import type { EventsService } from '../events/events.service.js';
import type { CloudinaryService } from '../uploads/cloudinary.service.js';
import { ChoreCronService } from './chore-cron.service.js';

function build(nodeEnv: string) {
  const catchUpAll = vi.fn().mockResolvedValue(0);
  const ensureSchedule = vi.fn();
  const svc = new ChoreCronService(
    {} as PrismaService,
    { catchUpAll, ensureSchedule } as unknown as ScheduleService,
    {} as EventsService,
    {} as AuditService,
    {} as CloudinaryService,
    { get: () => nodeEnv } as unknown as ConfigService<never, true>,
  );
  return { svc, catchUpAll };
}

describe('ChoreCronService.onApplicationBootstrap', () => {
  it('khởi động server thật: sinh bù lịch cho mọi nhà (cron có thể đã bị lỡ lúc server ngủ)', () => {
    const { svc, catchUpAll } = build('production');
    svc.onApplicationBootstrap();
    expect(catchUpAll).toHaveBeenCalledTimes(1);
  });

  it('môi trường test: bỏ qua để các e2e chạy song song không đụng dữ liệu của nhau', () => {
    const { svc, catchUpAll } = build('test');
    svc.onApplicationBootstrap();
    expect(catchUpAll).not.toHaveBeenCalled();
  });

  it('sinh bù lỗi không làm server khởi động thất bại và không gây unhandled rejection', async () => {
    const { svc, catchUpAll } = build('development');
    catchUpAll.mockRejectedValue(new Error('db down'));
    expect(() => svc.onApplicationBootstrap()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(catchUpAll).toHaveBeenCalledTimes(1);
  });
});

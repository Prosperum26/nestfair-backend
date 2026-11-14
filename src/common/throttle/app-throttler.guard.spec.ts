import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard.js';
import { throttlerOptions } from './throttle.config.js';

const contextOf = (type: string) =>
  ({ getType: () => type, getHandler: () => () => {}, getClass: () => class {} }) as unknown as ExecutionContext;

describe('AppThrottlerGuard', () => {
  const guard = new AppThrottlerGuard(
    { ...throttlerOptions, skipIf: () => false },
    new ThrottlerStorageService(),
    new Reflector(),
  ) as unknown as { shouldSkip(ctx: ExecutionContext): Promise<boolean> };

  it('bỏ qua ngữ cảnh WebSocket', async () => {
    expect(await guard.shouldSkip(contextOf('ws'))).toBe(true);
  });

  it('không bỏ qua HTTP', async () => {
    expect(await guard.shouldSkip(contextOf('http'))).toBe(false);
  });
});

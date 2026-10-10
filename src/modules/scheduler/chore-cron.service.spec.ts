import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { ChoreScheduleService } from '../chores/chore-schedule.service.js';
import type { EventsService } from '../events/events.service.js';
import { ChoreCronService } from './chore-cron.service.js';

function build(houseIds: string[], generate: ChoreScheduleService['generateWeek']) {
  const findMany = vi.fn().mockResolvedValue(houseIds.map((id) => ({ id })));
  const emitToHouse = vi.fn();
  const generateWeek = vi.fn(generate);
  const svc = new ChoreCronService(
    { house: { findMany } } as unknown as PrismaService,
    { generateWeek } as unknown as ChoreScheduleService,
    { emitToHouse } as unknown as EventsService,
  );
  return { svc, generateWeek, emitToHouse };
}

const ok = (created: number) => async () => ({ assignments: [], relaxed: false, created });

describe('ChoreCronService.generateNextWeek', () => {
  it('Chủ Nhật 20:00 giờ VN: tạo lịch tuần kế tiếp (source AUTO) cho từng nhà', async () => {
    const { svc, generateWeek } = build(['h1', 'h2'], ok(4));
    const res = await svc.generateNextWeek(new Date('2026-10-11T13:00:00Z'));
    expect(generateWeek).toHaveBeenCalledWith('h1', '2026-W42', 'AUTO');
    expect(generateWeek).toHaveBeenCalledWith('h2', '2026-W42', 'AUTO');
    expect(res).toEqual({ houses: 2, created: 8 });
  });

  it('chạy giữa tuần vẫn nhắm tuần liền sau tuần hiện tại', async () => {
    const { svc, generateWeek } = build(['h1'], ok(1));
    await svc.generateNextWeek(new Date('2026-10-07T05:00:00Z'));
    expect(generateWeek).toHaveBeenCalledWith('h1', '2026-W42', 'AUTO');
  });

  it('một nhà lỗi không chặn các nhà còn lại', async () => {
    const { svc, generateWeek } = build(['h1', 'h2', 'h3'], async (houseId) => {
      if (houseId === 'h2') throw new Error('boom');
      return { assignments: [], relaxed: false, created: 3 };
    });
    const res = await svc.generateNextWeek(new Date('2026-10-11T13:00:00Z'));
    expect(generateWeek).toHaveBeenCalledTimes(3);
    expect(res).toEqual({ houses: 2, created: 6 });
  });

  it('chỉ emit chore:shuffled cho nhà thực sự có lịch mới (created > 0)', async () => {
    const { svc, emitToHouse } = build(['h1', 'h2'], async (houseId) => ({
      assignments: [],
      relaxed: houseId === 'h1',
      created: houseId === 'h1' ? 4 : 0,
    }));
    await svc.generateNextWeek(new Date('2026-10-11T13:00:00Z'));
    expect(emitToHouse).toHaveBeenCalledTimes(1);
    expect(emitToHouse).toHaveBeenCalledWith('h1', 'chore:shuffled', { weekKey: '2026-W42', relaxed: true });
  });
});

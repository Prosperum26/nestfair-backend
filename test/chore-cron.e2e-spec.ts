import { ChoreCronService } from '../src/modules/scheduler/chore-cron.service.js';
import { createFixture } from './support/house-fixture.js';

describe('Chore cron (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let cron: ChoreCronService;

  beforeAll(async () => {
    fx = await createFixture('@e2e-cron.nestfair.test');
    cron = fx.app.get(ChoreCronService);
  });
  afterAll(() => fx.cleanup());

  it('listSchedulableHouseIds: chỉ nhà có việc đang bật và thành viên còn ở', async () => {
    const withChore = await fx.houseWith(['Hùng', 'Thiện']);
    await fx.prisma.chore.create({ data: { houseId: withChore.houseId, title: 'A', weight: 1 } });
    const noChore = await fx.houseWith(['Mai', 'Quân']);
    const inactiveOnly = await fx.houseWith(['An', 'Bình']);
    await fx.prisma.chore.create({
      data: { houseId: inactiveOnly.houseId, title: 'B', weight: 1, isActive: false },
    });

    const ids = await cron.listSchedulableHouseIds();
    expect(ids).toContain(withChore.houseId);
    expect(ids).not.toContain(noChore.houseId);
    expect(ids).not.toContain(inactiveOnly.houseId);
  });

  it('markMissed: chỉ TODO và REJECTED quá hạn chuyển MISSED', async () => {
    const { houseId, users, memberId } = await fx.houseWith(['Hùng', 'Thiện']);
    const chore = await fx.prisma.chore.create({ data: { houseId, title: 'Đổ rác', weight: 1 } });
    const past = new Date(Date.now() - 3_600_000);
    const future = new Date(Date.now() + 3_600_000);
    const mk = (weekKey: string, status: 'TODO' | 'REJECTED' | 'PENDING_VERIFY' | 'DONE', dueAt: Date) =>
      fx.prisma.choreAssignment.create({
        data: { houseId, choreId: chore.id, assigneeId: memberId(users[1]), originalAssigneeId: memberId(users[1]), weekKey, dueAt, status, source: 'AUTO' },
      });
    const todoPast = await mk('2026-W01', 'TODO', past);
    const rejectedPast = await mk('2026-W02', 'REJECTED', past);
    const pendingPast = await mk('2026-W03', 'PENDING_VERIFY', past);
    const donePast = await mk('2026-W04', 'DONE', past);
    const todoFuture = await mk('2026-W05', 'TODO', future);

    expect(await cron.markMissed()).toBeGreaterThanOrEqual(2);

    const status = async (id: string) =>
      (await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(todoPast.id)).toBe('MISSED');
    expect(await status(rejectedPast.id)).toBe('MISSED');
    expect(await status(pendingPast.id)).toBe('PENDING_VERIFY');
    expect(await status(donePast.id)).toBe('DONE');
    expect(await status(todoFuture.id)).toBe('TODO');
  });
});

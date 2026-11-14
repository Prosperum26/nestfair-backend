import type { PrismaService } from '../../prisma/prisma.service.js';
import { ChoreTodayDigestSource } from './reminder-cron.service.js';

const shifts = [{ titleSnapshot: 'Cọ WC', dueAt: new Date('2026-11-04T13:00:00Z') }];

describe('ChoreTodayDigestSource và công tắc choreDigest', () => {
  let prisma: {
    user: { findUnique: ReturnType<typeof vi.fn> };
    choreAssignment: { findMany: ReturnType<typeof vi.fn> };
  };
  let source: ChoreTodayDigestSource;

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ notificationPrefs: null }) },
      choreAssignment: { findMany: vi.fn().mockResolvedValue(shifts) },
    };
    source = new ChoreTodayDigestSource(prisma as unknown as PrismaService);
  });

  it('chưa chỉnh công tắc (null) thì vẫn có bản tin', async () => {
    const lines = await source.linesFor('u1', 'h1', '2026-11-04');
    expect(lines).toEqual(['Hôm nay bạn có 1 ca: Cọ WC (đến 20:00)']);
  });

  it('tắt choreDigest thì không có dòng nào và không cần truy vấn ca', async () => {
    prisma.user.findUnique.mockResolvedValue({ notificationPrefs: { choreDigest: false } });
    expect(await source.linesFor('u1', 'h1', '2026-11-04')).toEqual([]);
    expect(prisma.choreAssignment.findMany).not.toHaveBeenCalled();
  });

  it('tắt công tắc khác (debtPaid) thì bản tin việc nhà vẫn gửi', async () => {
    prisma.user.findUnique.mockResolvedValue({ notificationPrefs: { debtPaid: false } });
    expect(await source.linesFor('u1', 'h1', '2026-11-04')).toHaveLength(1);
  });
});

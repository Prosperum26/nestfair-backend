import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ChoreScheduleService } from '../chores/chore-schedule.service.js';
import { shiftWeek, weekKeyOf } from '../chores/week.js';
import { EventsService } from '../events/events.service.js';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

@Injectable()
export class ChoreCronService {
  private readonly logger = new Logger(ChoreCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ChoreScheduleService,
    private readonly events: EventsService,
  ) {}

  /** Nhà có ít nhất 1 việc đang bật và 1 thành viên còn ở. */
  async listSchedulableHouseIds(): Promise<string[]> {
    const houses = await this.prisma.house.findMany({
      where: {
        chores: { some: { isActive: true } },
        members: { some: { leftAt: null } },
      },
      select: { id: true },
    });
    return houses.map((h) => h.id);
  }

  /**
   * Chủ Nhật 20:00 giờ VN: tạo lịch tuần kế tiếp cho mọi nhà.
   * Idempotent: nhà đã có lịch tuần đó thì bị bỏ qua (generateWeek AUTO).
   */
  @Cron('0 20 * * 0', { timeZone: TIME_ZONE })
  async generateNextWeek(
    now: Date = new Date(),
  ): Promise<{ houses: number; created: number }> {
    const weekKey = shiftWeek(weekKeyOf(now), 1);
    let houses = 0;
    let created = 0;
    for (const houseId of await this.listSchedulableHouseIds()) {
      try {
        const res = await this.schedule.generateWeek(houseId, weekKey, 'AUTO');
        houses++;
        created += res.created;
        if (res.created > 0) {
          this.events.emitToHouse(houseId, 'chore:shuffled', {
            weekKey,
            relaxed: res.relaxed,
          });
        }
      } catch (e) {
        // Một nhà lỗi không được chặn các nhà còn lại.
        this.logger.error(`Tạo lịch ${weekKey} cho nhà ${houseId} thất bại`, e as Error);
      }
    }
    return { houses, created };
  }

  /** Mỗi giờ: ca TODO / REJECTED đã quá hạn → MISSED. Ca đã nộp chờ duyệt thì giữ nguyên. */
  @Cron('0 * * * *', { timeZone: TIME_ZONE })
  async markMissed(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.choreAssignment.updateMany({
      where: { status: { in: ['TODO', 'REJECTED'] }, dueAt: { lt: now } },
      data: { status: 'MISSED' },
    });
    return count;
  }
}

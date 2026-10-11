import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ScheduleService } from '../chores/schedule.service.js';
import { addDays, currentWeekStart } from '../chores/week.js';
import { EventsService } from '../events/events.service.js';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

@Injectable()
export class ChoreCronService {
  private readonly logger = new Logger(ChoreCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
    private readonly events: EventsService,
  ) {}

  /** Chủ Nhật 20:00 giờ nhà: sinh lịch tuần kế tiếp cho mọi nhà (nhà chưa có việc thì lịch EMPTY, không lỗi). */
  @Cron('0 20 * * 0', { timeZone: TIME_ZONE })
  async generateNextWeek(now: Date = new Date(), houseIds?: string[]): Promise<{ houses: number; created: number }> {
    const weekStart = addDays(currentWeekStart(now), 7);
    const ids = houseIds ?? (await this.prisma.house.findMany({ select: { id: true } })).map((h) => h.id);
    let houses = 0;
    let created = 0;
    for (const houseId of ids) {
      try {
        const res = await this.schedule.ensureSchedule(houseId, weekStart, 'CRON', now);
        houses++;
        if (res.created) {
          created++;
          this.events.emitToHouse(houseId, 'chore:shuffled', {
            weekKey: res.schedule.weekKey,
            relaxed: res.schedule.relaxed,
            reasons: res.schedule.reasons,
          });
        }
      } catch (e) {
        // Một nhà lỗi không được chặn các nhà còn lại.
        this.logger.error(`Tạo lịch ${weekStart} cho nhà ${houseId} thất bại`, e as Error);
      }
    }
    return { houses, created };
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import type { HouseMembership } from '../houses/guards/house-member.guard.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { actorOfMember } from '../events/actor.js';
import { EventsService } from '../events/events.service.js';
import { ASSIGNMENT_INCLUDE, toAssignmentDto, toScheduleMeta } from './assignment.mapper.js';
import type { PreviewResultDto, ShuffleResultDto, WeekViewDto } from './dto/assignment-response.dto.js';
import type { ShuffleAssignmentsDto } from './dto/week-key.dto.js';
import type { WeekSchedule } from '../../generated/prisma/client.js';
import { dateOf, type Db } from './schedule-context.js';
import { ScheduleService } from './schedule.service.js';
import { addDays, currentWeekStart, type DateStr, isValidWeekKey, weekStartFromKey } from './week.js';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
  ) {}

  private weekStartOf(weekKey: string | undefined, now: Date): DateStr {
    if (weekKey === undefined) return currentWeekStart(now);
    if (!isValidWeekKey(weekKey)) {
      throw new BadRequestException('Tuần không hợp lệ, định dạng đúng là 2026-W41.');
    }
    return weekStartFromKey(weekKey);
  }

  private async view(houseId: string, weekStart: DateStr, now: Date): Promise<WeekViewDto> {
    const [sched, rows] = await Promise.all([
      this.prisma.weekSchedule.findUnique({ where: { houseId_weekStart: { houseId, weekStart: dateOf(weekStart) } } }),
      this.prisma.choreAssignment.findMany({
        // Ca vòng quay chỉ hiện khi bánh xe đã dừng (không lộ kết quả trước animation).
        where: { houseId, weekStart: dateOf(weekStart), OR: [{ wheelLog: { is: null } }, { wheelLog: { is: { revealAt: { lte: now } } } }] },
        include: ASSIGNMENT_INCLUDE,
        orderBy: [{ occurrenceDate: 'asc' }, { dueAt: 'asc' }, { titleSnapshot: 'asc' }],
      }),
    ]);
    return { schedule: sched ? toScheduleMeta(sched, now) : null, assignments: rows.map(toAssignmentDto) };
  }

  /**
   * Lịch một tuần kèm `scheduleMeta`. Tuần hiện tại / kế tiếp mà chưa có lịch thì sinh bù (CATCHUP);
   * ca của người đã rời nhà được giao lại trước khi trả về.
   */
  async weekView(houseId: string, week?: string, now: Date = new Date()): Promise<WeekViewDto> {
    const weekStart = this.weekStartOf(week, now);
    const cur = currentWeekStart(now);
    if (weekStart === cur || weekStart === addDays(cur, 7)) {
      await this.schedule.ensureSchedule(houseId, weekStart, 'CATCHUP', now);
    }
    await this.schedule.reassignOrphans(houseId, now);
    return this.view(houseId, weekStart, now);
  }

  preview(houseId: string, weekKey: string, now: Date = new Date()): Promise<PreviewResultDto> {
    return this.schedule.previewSchedule(houseId, this.weekStartOf(weekKey, now), now);
  }

  async shuffle(houseId: string, actor: Pick<HouseMembership, 'id' | 'role'>, dto: ShuffleAssignmentsDto, now: Date = new Date()): Promise<ShuffleResultDto> {
    const weekStart = this.weekStartOf(dto.weekKey, now);
    const who = await actorOfMember(this.prisma, actor.id);
    const outbox = this.events.outbox();
    // Live Ticker: một mục cho cả lịch (không phải từng ca), ghi trong transaction sinh / xáo lịch.
    const record = (type: 'schedule.generated' | 'schedule.rerolled') => async (tx: Db, s: WeekSchedule) => {
      if (s.status === 'EMPTY') return;
      await this.activity.record(tx, outbox, {
        houseId,
        type,
        actor: who,
        params: { weekKey: s.weekKey, relaxed: s.relaxed },
        dedupeKey: `schedule:${s.id}:${s.rerollCount}`,
      });
    };
    let changed: boolean;
    let message: string | undefined;
    if (dto.mode === 'CREATE') {
      changed = (await this.schedule.createSchedule(houseId, weekStart, now, record('schedule.generated'))).created;
    } else {
      const res = await this.schedule.rerollSchedule(houseId, weekStart, { memberId: actor.id, role: actor.role }, now, record('schedule.rerolled'));
      changed = res.changed;
      message = res.message;
    }
    const view = await this.view(houseId, weekStart, now);
    if (changed && view.schedule) {
      outbox.toHouse(houseId, 'chore:shuffled', { weekKey: view.schedule.weekKey, relaxed: view.schedule.relaxed, reasons: view.schedule.reasons }, who);
    }
    outbox.flush();
    return { changed, message, schedule: view.schedule, assignments: view.assignments };
  }
}

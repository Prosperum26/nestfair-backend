import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { coded } from '../../common/coded-exception.js';
import type { WeekSchedule } from '../../generated/prisma/client.js';
import type { GeneratedBy, HouseRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { ALGO_VERSION, generateWeek, type GenResult, type GenSlot } from './algorithms/schedule-generator.js';
import { rollingLoad } from './algorithms/load.js';
import { AuditService } from './audit.service.js';
import { buildGenContext, dateOf, type Db, dsOf, type GenContext } from './schedule-context.js';
import { addDays, currentWeekStart, type DateStr, dueAtOf, toDateStr, weekKeyFromStart } from './week.js';

export const MAX_REROLLS = 2;
const REROLL_TRIES = 20;
export const NO_ALTERNATIVE_MESSAGE = 'Không có phương án khác thỏa rào công bằng';

export interface PreviewResult {
  seed: number;
  status: GenResult['status'];
  relaxed: boolean;
  relaxLevel: number;
  fenceWeeksApplied: number;
  reasons: string[];
  slots: { choreId: string; choreTitle: string; occurrenceDate: DateStr; memberId: string | null }[];
}

const randomSeed = () => randomInt(1, 2 ** 31 - 1);

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  /** H5: chỉ sinh cho tuần hiện tại hoặc tuần kế tiếp. */
  private checkRange(weekStart: DateStr, now: Date) {
    const cur = currentWeekStart(now);
    if (weekStart !== cur && weekStart !== addDays(cur, 7)) {
      throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'WEEK_OUT_OF_RANGE', 'Chỉ có thể tạo lịch cho tuần này hoặc tuần sau.');
    }
  }

  /** Khóa advisory theo nhà: các kênh sinh lịch chạy trùng vẫn chỉ ra một lịch (kết hợp UNIQUE(houseId, weekStart)). */
  private withHouseLock<T>(houseId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${houseId}::text))::text`;
        return fn(tx);
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  }

  /** Mọi kênh (cron, sinh bù, đọc lịch, tạo) đi qua đây. Idempotent theo (houseId, weekStart). */
  async ensureSchedule(
    houseId: string,
    weekStart: DateStr,
    by: GeneratedBy,
    now: Date = new Date(),
  ): Promise<{ schedule: WeekSchedule; created: boolean }> {
    this.checkRange(weekStart, now);
    return this.withHouseLock(houseId, async (tx) => {
      const existing = await tx.weekSchedule.findUnique({ where: { houseId_weekStart: { houseId, weekStart: dateOf(weekStart) } } });
      if (existing) return { schedule: existing, created: false };
      return { schedule: await this.generateAndStore(tx, houseId, weekStart, by, randomSeed(), now), created: true };
    });
  }

  /** "Tạo lịch tuần này": có lịch rồi thì trả lịch cũ (S-34); lịch EMPTY thì sinh lại (vừa thêm việc). */
  async createSchedule(houseId: string, weekStart: DateStr, now: Date = new Date()): Promise<{ schedule: WeekSchedule; created: boolean }> {
    this.checkRange(weekStart, now);
    return this.withHouseLock(houseId, async (tx) => {
      const existing = await tx.weekSchedule.findUnique({ where: { houseId_weekStart: { houseId, weekStart: dateOf(weekStart) } } });
      if (existing && existing.status !== 'EMPTY') return { schedule: existing, created: false };
      if (existing) await tx.weekSchedule.delete({ where: { id: existing.id } });
      return { schedule: await this.generateAndStore(tx, houseId, weekStart, 'USER', randomSeed(), now), created: true };
    });
  }

  /** Dry-run: không ghi gì, trả seed để người xem thấy "không thiên vị". */
  async previewSchedule(houseId: string, weekStart: DateStr, now: Date = new Date()): Promise<PreviewResult> {
    this.checkRange(weekStart, now);
    const seed = randomSeed();
    const ctx = await buildGenContext(this.prisma, houseId, weekStart, seed);
    const res = generateWeek(ctx.input);
    return {
      seed,
      status: res.status,
      relaxed: res.relaxed,
      relaxLevel: res.relaxLevel,
      fenceWeeksApplied: res.fenceWeeksApplied,
      reasons: res.reasons,
      slots: res.slots.map((s) => ({
        choreId: s.choreId,
        choreTitle: ctx.chores.get(s.choreId)!.title,
        occurrenceDate: s.occurrenceDate,
        memberId: s.memberId,
      })),
    };
  }

  /** Xáo lại lịch (chỉ Admin, trước khi tuần bắt đầu, ≤ 2 lần, chưa ca nào được nộp/duyệt). */
  async rerollSchedule(
    houseId: string,
    weekStart: DateStr,
    actor: { memberId: string; role: HouseRole },
    now: Date = new Date(),
  ): Promise<{ changed: boolean; schedule: WeekSchedule; message?: string }> {
    if (actor.role !== 'ADMIN') throw coded(HttpStatus.FORBIDDEN, 'ADMIN_ONLY', 'Chỉ trưởng phòng mới xáo lại được lịch.');
    return this.withHouseLock(houseId, async (tx) => {
      const sched = await tx.weekSchedule.findUnique({ where: { houseId_weekStart: { houseId, weekStart: dateOf(weekStart) } } });
      if (!sched || sched.status === 'EMPTY') throw coded(HttpStatus.NOT_FOUND, 'SCHEDULE_NOT_FOUND', 'Tuần này chưa có lịch để xáo lại.');
      if (weekStart <= toDateStr(now)) throw coded(HttpStatus.CONFLICT, 'SCHEDULE_LOCKED', 'Tuần này đã bắt đầu nên lịch đã khóa.');
      const activity = await tx.choreAssignment.count({
        where: { scheduleId: sched.id, status: { notIn: ['TODO', 'UNASSIGNED', 'CANCELLED'] } },
      });
      if (activity > 0) throw coded(HttpStatus.CONFLICT, 'SCHEDULE_HAS_ACTIVITY', 'Đã có ca được nộp hoặc duyệt, không thể xáo lại cả lịch.');
      if (sched.rerollCount >= MAX_REROLLS) throw coded(HttpStatus.CONFLICT, 'REROLL_LIMIT', `Mỗi lịch chỉ được xáo lại tối đa ${MAX_REROLLS} lần.`);

      const current = await tx.choreAssignment.findMany({ where: { scheduleId: sched.id } });
      const signature = (rows: { choreId: string; day: string; who: string | null }[]) =>
        rows.map((r) => `${r.choreId}|${r.day}|${r.who ?? ''}`).sort().join(';');
      const currentSig = signature(current.map((a) => ({ choreId: a.choreId, day: dsOf(a.occurrenceDate), who: a.assigneeId })));

      const ctx = await buildGenContext(tx, houseId, weekStart, 0);
      let accepted: { seed: number; res: GenResult } | null = null;
      for (let i = 0; i < REROLL_TRIES && !accepted; i++) {
        const seed = randomSeed();
        const res = generateWeek({ ...ctx.input, seed });
        const sig = signature(res.slots.map((s) => ({ choreId: s.choreId, day: s.occurrenceDate, who: s.memberId })));
        if (res.status !== 'EMPTY' && sig !== currentSig) accepted = { seed, res };
      }
      if (!accepted) return { changed: false, schedule: sched, message: NO_ALTERNATIVE_MESSAGE };

      await tx.choreAssignment.deleteMany({ where: { scheduleId: sched.id } });
      const updated = await tx.weekSchedule.update({
        where: { id: sched.id },
        data: {
          ...this.scheduleFields(accepted.res, accepted.seed),
          generatedBy: 'ADMIN_REROLL',
          rerollCount: sched.rerollCount + 1,
        },
      });
      await this.insertSlots(tx, houseId, updated, ctx, accepted.res.slots);
      await this.audit.log(houseId, actor.memberId, 'REROLL', { weekKey: updated.weekKey, oldSeed: sched.seed, newSeed: accepted.seed }, { scheduleId: sched.id }, tx);
      return { changed: true, schedule: updated };
    });
  }

  /**
   * Sinh bù cho mọi nhà (hoặc `houseIds`): khi server khởi động / cron bị lỡ. Tuần hiện tại luôn; tuần kế tiếp
   * khi đã qua Chủ Nhật 20:00 giờ nhà. Trả số lịch mới tạo.
   */
  async catchUpAll(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    const ids = houseIds ?? (await this.prisma.house.findMany({ select: { id: true } })).map((h) => h.id);
    const cur = currentWeekStart(now);
    const vn = new Date(now.getTime() + 7 * 3_600_000);
    const weeks = vn.getUTCDay() === 0 && vn.getUTCHours() >= 20 ? [cur, addDays(cur, 7)] : [cur];
    let created = 0;
    for (const houseId of ids) {
      for (const ws of weeks) {
        try {
          if ((await this.ensureSchedule(houseId, ws, 'CATCHUP', now)).created) created++;
        } catch (e) {
          this.logger.error(`Sinh bù lịch ${ws} cho nhà ${houseId} thất bại`, e as Error);
        }
      }
    }
    return created;
  }

  /**
   * S-18: ca TODO tương lai của người đã rời nhà → giao người đủ điều kiện có tải thấp nhất (tôn trọng cap và rào nếu được);
   * không ai nhận được thì UNASSIGNED. Giữ `originalAssigneeId`.
   */
  async reassignOrphans(houseId: string, now: Date = new Date()): Promise<{ moved: number; unassigned: number }> {
    const orphans = await this.prisma.choreAssignment.findMany({
      where: { houseId, status: 'TODO', dueAt: { gt: now }, assignee: { leftAt: { not: null } } },
      orderBy: [{ occurrenceDate: 'asc' }, { choreId: 'asc' }],
    });
    if (orphans.length === 0) return { moved: 0, unassigned: 0 };

    let moved = 0;
    let unassigned = 0;
    const touched: string[] = [];
    const byWeek = new Map<DateStr, typeof orphans>();
    for (const o of orphans) byWeek.set(dsOf(o.weekStart), [...(byWeek.get(dsOf(o.weekStart)) ?? []), o]);

    for (const [weekStart, rows] of byWeek) {
      const ctx = await buildGenContext(this.prisma, houseId, weekStart, 0);
      const ids = ctx.input.members.map((m) => m.id);
      const load = rollingLoad(ctx.input.history, ids, { credit: ctx.input.credit });
      const live = await this.prisma.choreAssignment.findMany({
        where: { houseId, weekStart: dateOf(weekStart), assigneeId: { in: ids }, status: { notIn: ['CANCELLED', 'UNASSIGNED'] } },
      });
      const perDay = new Map<string, number>();
      for (const a of live) {
        load[a.assigneeId!] += a.weightSnapshot;
        const k = `${a.assigneeId}|${dsOf(a.occurrenceDate)}`;
        perDay.set(k, (perDay.get(k) ?? 0) + 1);
      }
      const fenced = new Set(ctx.input.history.filter((h) => h.weeksBack <= 2 && h.source !== 'WHEEL').map((h) => `${h.memberId}|${h.choreId}`));

      for (const o of rows) {
        const day = dsOf(o.occurrenceDate);
        const avail = ctx.input.members.filter((m) => !m.absentDates.has(day)).map((m) => m.id);
        const underCap = avail.filter((m) => (perDay.get(`${m}|${day}`) ?? 0) < ctx.input.maxSlotsPerDay);
        const pool = underCap.length > 0 ? underCap : avail;
        const preferred = pool.filter((m) => !fenced.has(`${m}|${o.choreId}`));
        const pick = (preferred.length > 0 ? preferred : pool).sort((a, b) => load[a] - load[b])[0];
        const data = pick
          ? { assigneeId: pick, source: 'REASSIGN' as const }
          : { assigneeId: null, status: 'UNASSIGNED' as const };
        const { count } = await this.prisma.choreAssignment.updateMany({ where: { id: o.id, status: 'TODO', assigneeId: o.assigneeId }, data });
        if (count === 0) continue;
        touched.push(o.id);
        if (pick) {
          moved++;
          load[pick] += o.weightSnapshot;
          perDay.set(`${pick}|${day}`, (perDay.get(`${pick}|${day}`) ?? 0) + 1);
        } else unassigned++;
        await this.audit.log(houseId, null, pick ? 'ORPHAN_REASSIGN' : 'ORPHAN_UNASSIGNED', { from: o.assigneeId, to: pick ?? null }, { assignmentId: o.id });
      }
    }
    if (touched.length > 0) this.events.emitToHouse(houseId, 'chore:reassigned', { assignmentIds: touched });
    return { moved, unassigned };
  }

  // ---- nội bộ ----

  private scheduleFields(res: GenResult, seed: number) {
    return {
      seed,
      attempts: res.attempts,
      fenceWeeksApplied: res.fenceWeeksApplied,
      relaxLevel: res.relaxLevel,
      relaxed: res.relaxed,
      reasons: res.reasons,
      loadSnapshot: { after: res.loadAfter },
      algoVersion: ALGO_VERSION,
    };
  }

  private async generateAndStore(tx: Db, houseId: string, weekStart: DateStr, by: GeneratedBy, seed: number, now: Date): Promise<WeekSchedule> {
    const ctx = await buildGenContext(tx, houseId, weekStart, seed);
    const res = generateWeek(ctx.input);
    const started = weekStart <= toDateStr(now);
    const schedule = await tx.weekSchedule.create({
      data: {
        houseId,
        weekStart: dateOf(weekStart),
        weekKey: weekKeyFromStart(weekStart),
        status: res.status === 'EMPTY' ? 'EMPTY' : started ? 'LOCKED' : 'PUBLISHED',
        generatedBy: by,
        ...this.scheduleFields(res, seed),
      },
    });
    await this.insertSlots(tx, houseId, schedule, ctx, res.slots);
    return schedule;
  }

  private async insertSlots(tx: Db, houseId: string, schedule: WeekSchedule, ctx: GenContext, slots: GenSlot[]) {
    if (slots.length === 0) return;
    await tx.choreAssignment.createMany({
      data: slots.map((s) => {
        const chore = ctx.chores.get(s.choreId)!;
        return {
          houseId,
          scheduleId: schedule.id,
          choreId: s.choreId,
          assigneeId: s.memberId,
          originalAssigneeId: s.memberId,
          weekKey: schedule.weekKey,
          weekStart: schedule.weekStart,
          occurrenceDate: dateOf(s.occurrenceDate),
          slotIndex: s.slotIndex,
          dueAt: dueAtOf(s.occurrenceDate, chore.dueTime),
          titleSnapshot: chore.title,
          weightSnapshot: chore.weight,
          source: s.source,
          status: s.memberId ? ('TODO' as const) : ('UNASSIGNED' as const),
        };
      }),
    });
  }
}

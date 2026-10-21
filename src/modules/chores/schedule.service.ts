import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { coded } from '../../common/coded-exception.js';
import type { WeekSchedule } from '../../generated/prisma/client.js';
import type { AssignmentSource, GeneratedBy, HouseRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { generateWeek, type GenResult } from './algorithms/schedule-generator.js';
import { rollingLoad } from './algorithms/load.js';
import { ChoreDebtService } from '../swaps/chore-debt.service.js';
import { AuditService } from './audit.service.js';
import { buildGenContext, dateOf, type Db, dsOf } from './schedule-context.js';
import { createScheduleRows, scheduleFields, storeSlots } from './schedule-store.js';
import { addDays, currentWeekStart, type DateStr, toDateStr } from './week.js';

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
  slots: { choreId: string; choreTitle: string; occurrenceDate: DateStr; memberId: string | null; memberUserId: string | null; memberName: string | null }[];
}

const randomSeed = () => randomInt(1, 2 ** 31 - 1);

/** Gọi trong cùng transaction khi một lịch vừa được tạo / xáo lại (vd. ghi Live Ticker). */
export type OnScheduleChanged = (tx: Db, schedule: WeekSchedule) => Promise<void>;

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly debts: ChoreDebtService,
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
    onCreated?: OnScheduleChanged,
  ): Promise<{ schedule: WeekSchedule; created: boolean }> {
    this.checkRange(weekStart, now);
    return this.withHouseLock(houseId, async (tx) => {
      const existing = await tx.weekSchedule.findUnique({ where: { houseId_weekStart: { houseId, weekStart: dateOf(weekStart) } } });
      if (existing) return { schedule: existing, created: false };
      const schedule = await this.generateAndStore(tx, houseId, weekStart, by, randomSeed(), now);
      await onCreated?.(tx, schedule);
      return { schedule, created: true };
    });
  }

  /** "Tạo lịch tuần này": có lịch rồi thì trả lịch cũ (S-34); lịch EMPTY thì sinh lại (vừa thêm việc). */
  async createSchedule(
    houseId: string,
    weekStart: DateStr,
    now: Date = new Date(),
    onCreated?: OnScheduleChanged,
  ): Promise<{ schedule: WeekSchedule; created: boolean }> {
    this.checkRange(weekStart, now);
    return this.withHouseLock(houseId, async (tx) => {
      const existing = await tx.weekSchedule.findUnique({ where: { houseId_weekStart: { houseId, weekStart: dateOf(weekStart) } } });
      if (existing && existing.status !== 'EMPTY') return { schedule: existing, created: false };
      if (existing) await tx.weekSchedule.delete({ where: { id: existing.id } });
      const schedule = await this.generateAndStore(tx, houseId, weekStart, 'USER', randomSeed(), now);
      await onCreated?.(tx, schedule);
      return { schedule, created: true };
    });
  }

  /** Dry-run: không ghi gì, trả seed để người xem thấy "không thiên vị". */
  async previewSchedule(houseId: string, weekStart: DateStr, now: Date = new Date()): Promise<PreviewResult> {
    this.checkRange(weekStart, now);
    const seed = randomSeed();
    const ctx = await buildGenContext(this.prisma, houseId, weekStart, seed);
    const res = generateWeek(ctx.input);
    const people = await this.prisma.houseMember.findMany({
      where: { houseId, leftAt: null },
      select: { id: true, userId: true, user: { select: { fullName: true } } },
    });
    const byId = new Map(people.map((m) => [m.id, m]));
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
        memberUserId: s.memberId ? (byId.get(s.memberId)?.userId ?? null) : null,
        memberName: s.memberId ? (byId.get(s.memberId)?.user.fullName ?? null) : null,
      })),
    };
  }

  /** Xáo lại lịch (chỉ Admin, trước khi tuần bắt đầu, ≤ 2 lần, chưa ca nào được nộp/duyệt). */
  async rerollSchedule(
    houseId: string,
    weekStart: DateStr,
    actor: { memberId: string; role: HouseRole },
    now: Date = new Date(),
    onRerolled?: OnScheduleChanged,
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
      const slotIds = (await tx.choreAssignment.findMany({ where: { scheduleId: sched.id }, select: { id: true } })).map((a) => a.id);
      const pendingSwaps = await tx.choreSwapRequest.findMany({
        where: { status: 'PENDING', OR: [{ fromAssignmentId: { in: slotIds } }, { toAssignmentId: { in: slotIds } }] },
        select: { id: true },
      });
      if (pendingSwaps.length > 0) {
        throw coded(HttpStatus.CONFLICT, 'SWAP_PENDING_IN_WEEK', 'Tuần này còn yêu cầu đổi ca đang chờ. Hãy hủy chúng trước khi xáo lại.', {
          swapIds: pendingSwaps.map((s) => s.id),
        });
      }
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
          ...scheduleFields(accepted.res, accepted.seed),
          generatedBy: 'ADMIN_REROLL',
          rerollCount: sched.rerollCount + 1,
        },
      });
      await storeSlots(tx, houseId, updated, ctx, accepted.res.slots);
      await this.audit.log(houseId, actor.memberId, 'REROLL', { weekKey: updated.weekKey, oldSeed: sched.seed, newSeed: accepted.seed }, { scheduleId: sched.id }, tx);
      await onRerolled?.(tx, updated);
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
    return this.reassignSlots(houseId, orphans, 'ORPHAN');
  }

  /**
   * S-20: khai vắng sau khi lịch đã công bố → các ca TODO của người đó trong khoảng vắng còn ≥ 24h được dời cho người
   * tải thấp nhất (không phát sinh nợ ca); ca còn < 24h giữ nguyên, phải dùng luồng đổi ca (Issue #7).
   */
  async moveSlotsForAbsence(
    houseId: string,
    userId: string,
    startDate: DateStr,
    endDate: DateStr,
    now: Date = new Date(),
  ): Promise<{ moved: number; unassigned: number }> {
    const member = await this.prisma.houseMember.findFirst({ where: { houseId, userId, leftAt: null }, select: { id: true } });
    if (!member) return { moved: 0, unassigned: 0 };
    const rows = await this.prisma.choreAssignment.findMany({
      where: {
        houseId,
        assigneeId: member.id,
        status: 'TODO',
        occurrenceDate: { gte: dateOf(startDate), lte: dateOf(endDate) },
        dueAt: { gte: new Date(now.getTime() + 24 * 3_600_000) },
      },
      orderBy: [{ occurrenceDate: 'asc' }, { choreId: 'asc' }],
    });
    return this.reassignSlots(houseId, rows, 'ABSENCE');
  }

  /** Giao lại các ca TODO `slots` (đã lọc) cho người đủ điều kiện; không ai nhận được thì UNASSIGNED. */
  private async reassignSlots(
    houseId: string,
    slots: { id: string; choreId: string; assigneeId: string | null; weekStart: Date; occurrenceDate: Date; weightSnapshot: number; source: AssignmentSource }[],
    kind: 'ORPHAN' | 'ABSENCE',
  ): Promise<{ moved: number; unassigned: number }> {
    if (slots.length === 0) return { moved: 0, unassigned: 0 };

    let moved = 0;
    let unassigned = 0;
    const touched: string[] = [];
    const byWeek = new Map<DateStr, typeof slots>();
    for (const o of slots) byWeek.set(dsOf(o.weekStart), [...(byWeek.get(dsOf(o.weekStart)) ?? []), o]);

    for (const [weekStart, rows] of byWeek) {
      const ctx = await buildGenContext(this.prisma, houseId, weekStart, 0);
      const ids = ctx.input.members.map((m) => m.id);
      const load = rollingLoad(ctx.input.history, ids, { credit: ctx.input.credit });
      // Ca vòng quay không tính tải và không tính trần ca/ngày (đặc tả #5, Q2).
      const live = await this.prisma.choreAssignment.findMany({
        where: { houseId, weekStart: dateOf(weekStart), assigneeId: { in: ids }, status: { notIn: ['CANCELLED', 'UNASSIGNED'] }, source: { not: 'WHEEL' } },
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
        const avail = ctx.input.members.filter((m) => m.id !== o.assigneeId && !m.absentDates.has(day)).map((m) => m.id);
        const underCap = avail.filter((m) => (perDay.get(`${m}|${day}`) ?? 0) < ctx.input.maxSlotsPerDay);
        const pool = underCap.length > 0 ? underCap : avail;
        const preferred = pool.filter((m) => !fenced.has(`${m}|${o.choreId}`));
        const pick = (preferred.length > 0 ? preferred : pool).sort((a, b) => load[a] - load[b])[0];
        // Ca vòng quay giữ nguồn WHEEL để vẫn không tính tải sau khi giao lại.
        const data = pick
          ? { assigneeId: pick, source: o.source === 'WHEEL' ? ('WHEEL' as const) : ('REASSIGN' as const) }
          : { assigneeId: null, status: 'UNASSIGNED' as const };
        const count = await this.prisma.$transaction(async (tx) => {
          const res = await tx.choreAssignment.updateMany({ where: { id: o.id, status: 'TODO', assigneeId: o.assigneeId }, data });
          // Ca được làm hộ bị dời vì người làm hộ vắng: nợ ca không còn lý do tồn tại (D9).
          if (res.count > 0 && kind === 'ABSENCE') await this.debts.cancelForMovedCover(tx, o.id);
          return res.count;
        });
        if (count === 0) continue;
        touched.push(o.id);
        if (pick) {
          moved++;
          load[pick] += o.weightSnapshot;
          perDay.set(`${pick}|${day}`, (perDay.get(`${pick}|${day}`) ?? 0) + 1);
        } else unassigned++;
        await this.audit.log(houseId, null, `${kind}_${pick ? 'REASSIGN' : 'UNASSIGNED'}`, { from: o.assigneeId, to: pick ?? null }, { assignmentId: o.id });
      }
    }
    if (touched.length > 0) this.events.outbox().toHouse(houseId, 'chore:reassigned', { assignmentIds: touched }).flush();
    return { moved, unassigned };
  }

  // ---- nội bộ ----

  private async generateAndStore(tx: Db, houseId: string, weekStart: DateStr, by: GeneratedBy, seed: number, now: Date): Promise<WeekSchedule> {
    const ctx = await buildGenContext(tx, houseId, weekStart, seed);
    const res = generateWeek(ctx.input);
    const started = weekStart <= toDateStr(now);
    const status = res.status === 'EMPTY' ? 'EMPTY' : started ? 'LOCKED' : 'PUBLISHED';
    const created = await createScheduleRows(tx, houseId, weekStart, by, seed, ctx, res, status);
    if (status !== 'EMPTY') await this.debts.openWindowsForNewSchedule(tx, houseId, created.weekStart, created.createdAt);
    return created;
  }
}

import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Env } from '../../config/env.validation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { AuditService } from '../chores/audit.service.js';
import { dateOf } from '../chores/schedule-context.js';
import { ScheduleService } from '../chores/schedule.service.js';
import { addDays, currentWeekStart, toDateStr } from '../chores/week.js';
import { EventsService } from '../events/events.service.js';
import { PaybackService } from '../swaps/payback.service.js';
import { ChoreDebtService } from '../swaps/chore-debt.service.js';
import { SwapLifecycleService } from '../swaps/swap-lifecycle.service.js';
import { CloudinaryService, publicIdFromUrl } from '../uploads/cloudinary.service.js';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 24 * 3_600_000;
/** Ca chờ duyệt quá bấy nhiêu giờ thì tự duyệt (§12 quyết định 3). */
export const AUTO_APPROVE_HOURS = 48;
/** Giữ ảnh minh chứng bấy nhiêu ngày (§12 quyết định 8). */
export const PROOF_RETENTION_DAYS = 60;
/** Số ca MISSED liên tiếp thì báo Admin (S-44). */
export const MISSED_STREAK = 3;
const CLEANUP_BATCH = 100;

interface TouchedRow {
  id: string;
  houseId: string;
  assigneeId: string | null;
}

/**
 * Cron của việc nhà. Mọi job an toàn khi chạy nhiều instance: sinh lịch dùng khóa advisory + UNIQUE,
 * đổi trạng thái dùng `FOR UPDATE SKIP LOCKED` và điều kiện trạng thái trong WHERE.
 * Mỗi job có hai lớp: phương thức logic (tham số `houseIds` để test gọi trực tiếp) và hàm `@Cron` mỏng bên dưới.
 */
@Injectable()
export class ChoreCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChoreCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService<Env, true>,
    private readonly activity: ActivityService,
    private readonly swapLifecycle: SwapLifecycleService,
    private readonly debts: ChoreDebtService,
    private readonly payback: PaybackService,
  ) {}

  private get isTest() {
    return this.config.get('NODE_ENV', { infer: true }) === 'test';
  }

  private scope(houseIds?: string[]) {
    return houseIds ? Prisma.sql`AND a."houseId" = ANY(${houseIds}::uuid[])` : Prisma.empty;
  }

  /** Cron có thể bị lỡ khi server ngủ (Render free): sinh bù ngay khi khởi động, không chặn việc khởi động. */
  onApplicationBootstrap(): void {
    if (this.isTest) return;
    void this.schedule.catchUpAll().catch((e: unknown) => this.logger.error('Sinh bù lịch lúc khởi động thất bại', e as Error));
  }

  // ---- Sinh lịch tuần kế tiếp ----

  /** Chủ Nhật 20:00 giờ nhà: sinh lịch tuần kế tiếp cho mọi nhà (nhà chưa có việc thì lịch EMPTY, không lỗi). */
  async generateNextWeek(now: Date = new Date(), houseIds?: string[]): Promise<{ houses: number; created: number }> {
    const weekStart = addDays(currentWeekStart(now), 7);
    const ids = houseIds ?? (await this.prisma.house.findMany({ select: { id: true } })).map((h) => h.id);
    let houses = 0;
    let created = 0;
    for (const houseId of ids) {
      try {
        const outbox = this.events.outbox();
        // Một mục ticker cho cả lịch tuần (không phải từng ca), cùng transaction sinh lịch.
        const res = await this.schedule.ensureSchedule(houseId, weekStart, 'CRON', now, async (tx, s) => {
          if (s.status === 'EMPTY') return;
          await this.activity.record(tx, outbox, {
            houseId,
            type: 'schedule.generated',
            actor: null,
            params: { weekKey: s.weekKey, relaxed: s.relaxed },
            dedupeKey: `schedule:${s.id}:${s.rerollCount}`,
          });
        });
        houses++;
        if (res.created) {
          created++;
          outbox.toHouse(houseId, 'chore:shuffled', { weekKey: res.schedule.weekKey, relaxed: res.schedule.relaxed, reasons: res.schedule.reasons });
        }
        outbox.flush();
      } catch (e) {
        // Một nhà lỗi không được chặn các nhà còn lại.
        this.logger.error(`Tạo lịch ${weekStart} cho nhà ${houseId} thất bại`, e as Error);
      }
    }
    return { houses, created };
  }

  // ---- Quá hạn ----

  /**
   * Ca TODO / REJECTED có `dueAt + ân hạn của nhà` đã qua → MISSED. Ca đã nộp chờ duyệt giữ nguyên.
   * Trả số ca được đánh dấu.
   */
  async markMissed(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    const outbox = this.events.outbox();
    const rows = await this.prisma.$transaction(async (tx) => {
      // Khóa các yêu cầu đổi ca dính tới ca sắp đánh MISSED trước (cùng thứ tự khóa với accept).
      const candidates = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT a.id FROM chore_assignments a JOIN houses h ON h.id = a."houseId"
        WHERE a.status IN ('TODO', 'REJECTED')
          AND a."dueAt" + h."choreGraceHours" * interval '1 hour' < ${now.toISOString()}::timestamp
          ${this.scope(houseIds)}`);
      await this.swapLifecycle.lockPendingFor(tx, candidates.map((c) => c.id));
      const touched = await tx.$queryRaw<TouchedRow[]>(Prisma.sql`
        WITH due AS (
          SELECT a.id FROM chore_assignments a JOIN houses h ON h.id = a."houseId"
          WHERE a.status IN ('TODO', 'REJECTED')
            AND a."dueAt" + h."choreGraceHours" * interval '1 hour' < ${now.toISOString()}::timestamp
            ${this.scope(houseIds)}
          FOR UPDATE OF a SKIP LOCKED
        )
        UPDATE chore_assignments c SET status = 'MISSED', "updatedAt" = (now() AT TIME ZONE 'UTC')
        FROM due WHERE c.id = due.id
        RETURNING c.id, c."houseId", c."assigneeId"`);
      if (touched.length === 0) return touched;
      await this.swapLifecycle.cancelPendingForAssignments(tx, outbox, touched.map((r) => r.id), 'SLOT_CHANGED');
      await this.debts.onAssignmentsMissed(tx, outbox, touched.map((r) => r.id), now);

      const byHouse = new Map<string, string[]>();
      for (const r of touched) byHouse.set(r.houseId, [...(byHouse.get(r.houseId) ?? []), r.id]);
      for (const [houseId, assignmentIds] of byHouse) outbox.toHouse(houseId, 'chore:missed', { assignmentIds });

      // Ticker: một mục mỗi người ("Quân bỏ 2 ca"), không phải mỗi ca.
      const detail = await tx.choreAssignment.findMany({
        where: { id: { in: touched.map((r) => r.id) }, assigneeId: { not: null } },
        select: { houseId: true, titleSnapshot: true, assignee: { select: { userId: true, user: { select: { fullName: true } } } } },
        orderBy: { dueAt: 'asc' },
      });
      const byPerson = new Map<string, { houseId: string; userId: string; name: string; titles: string[] }>();
      for (const d of detail) {
        const key = `${d.houseId}|${d.assignee!.userId}`;
        const g = byPerson.get(key) ?? { houseId: d.houseId, userId: d.assignee!.userId, name: d.assignee!.user.fullName, titles: [] };
        g.titles.push(d.titleSnapshot);
        byPerson.set(key, g);
      }
      for (const g of byPerson.values()) {
        await this.activity.record(tx, outbox, {
          houseId: g.houseId,
          type: 'chore.missed',
          actor: { userId: g.userId, name: g.name },
          params: { count: g.titles.length, choreTitle: g.titles[0], choreTitles: g.titles },
        });
      }
      return touched;
    });
    if (rows.length === 0) return 0;
    outbox.flush();
    await this.checkMissedStreaks(rows, now);
    return rows.length;
  }

  /** S-44: người nào vừa có ca MISSED mà 3 ca gần nhất đều MISSED thì ghi nhật ký và báo Admin (mỗi chuỗi một lần). */
  private async checkMissedStreaks(rows: TouchedRow[], now: Date) {
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.assigneeId || seen.has(r.assigneeId)) continue;
      seen.add(r.assigneeId);
      const recent = await this.prisma.choreAssignment.findMany({
        where: { assigneeId: r.assigneeId, status: { notIn: ['CANCELLED', 'UNASSIGNED'] }, dueAt: { lt: now } },
        orderBy: { dueAt: 'desc' },
        take: MISSED_STREAK,
      });
      if (recent.length < MISSED_STREAK || !recent.every((a) => a.status === 'MISSED')) continue;
      const latest = recent[0];
      const already = await this.prisma.choreAuditLog.count({ where: { houseId: r.houseId, action: 'MISSED_STREAK', assignmentId: latest.id } });
      if (already > 0) continue;
      const outbox = this.events.outbox();
      await this.prisma.$transaction(async (tx) => {
        await this.audit.log(r.houseId, null, 'MISSED_STREAK', { assigneeId: r.assigneeId, streak: MISSED_STREAK }, { assignmentId: latest.id }, tx);
        const admins = await tx.houseMember.findMany({ where: { houseId: r.houseId, role: 'ADMIN', leftAt: null }, select: { userId: true } });
        for (const a of admins) outbox.toUser(a.userId, 'chore:missed', { houseId: r.houseId, assigneeId: r.assigneeId, streak: MISSED_STREAK }, { houseId: r.houseId });
        const who = await tx.houseMember.findUniqueOrThrow({ where: { id: r.assigneeId! }, select: { userId: true, user: { select: { fullName: true } } } });
        // Chỉ trưởng phòng thấy (không bêu tên trước cả nhà).
        await this.activity.record(tx, outbox, {
          houseId: r.houseId,
          type: 'chore.missed_streak',
          actor: null,
          params: { targetUserId: who.userId, targetName: who.user.fullName, streak: MISSED_STREAK },
          visibility: 'ADMIN_ONLY',
          dedupeKey: `missed-streak:${latest.id}`,
        });
      });
      outbox.flush();
    }
  }

  // ---- Tự duyệt ----

  /** Ca PENDING_VERIFY quá 48h không ai duyệt → DONE `AUTO_APPROVED` (nhãn "Tự duyệt"). */
  async autoApprove(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    const at = now.toISOString();
    const outbox = this.events.outbox();
    const rows = await this.prisma.$transaction(async (tx) => {
      const touched = await tx.$queryRaw<(TouchedRow & { weekKey: string })[]>(Prisma.sql`
        WITH due AS (
          SELECT a.id FROM chore_assignments a
          WHERE a.status = 'PENDING_VERIFY'
            AND a."submittedAt" < ${at}::timestamp - ${AUTO_APPROVE_HOURS} * interval '1 hour'
            ${this.scope(houseIds)}
          FOR UPDATE OF a SKIP LOCKED
        )
        UPDATE chore_assignments c
        SET status = 'DONE', "verifyMode" = 'AUTO_APPROVED', "verifiedAt" = ${at}::timestamp, "updatedAt" = (now() AT TIME ZONE 'UTC')
        FROM due WHERE c.id = due.id
        RETURNING c.id, c."houseId", c."assigneeId", c."weekKey"`);
      const perHouse = new Map<string, number>();
      for (const r of touched) {
        outbox.toHouse(r.houseId, 'chore:verified', { assignmentId: r.id, weekKey: r.weekKey, assigneeId: r.assigneeId, status: 'DONE', verifyMode: 'AUTO_APPROVED' });
        await this.debts.onAssignmentDone(tx, outbox, r.id, now);
        await this.audit.log(r.houseId, null, 'AUTO_APPROVE', { afterHours: AUTO_APPROVE_HOURS }, { assignmentId: r.id }, tx);
        perHouse.set(r.houseId, (perHouse.get(r.houseId) ?? 0) + 1);
      }
      // Một mục mỗi nhà cho cả đợt tự duyệt.
      for (const [houseId, count] of perHouse) {
        await this.activity.record(tx, outbox, { houseId, type: 'chore.auto_approved', actor: null, params: { count, afterHours: AUTO_APPROVE_HOURS } });
      }
      return touched;
    });
    outbox.flush();
    return rows.length;
  }

  // ---- Dọn ảnh cũ ----

  /** Xóa ảnh minh chứng của ca DONE quá 60 ngày trên Cloudinary (giữ bản ghi). Idempotent. */
  async cleanupProofs(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    const where = {
      status: 'DONE' as const,
      proofImageUrl: { not: null },
      submittedAt: { lt: new Date(now.getTime() - PROOF_RETENTION_DAYS * DAY_MS) },
      ...(houseIds ? { houseId: { in: houseIds } } : {}),
    };
    let cleaned = 0;
    for (let round = 0; round < 50; round++) {
      const batch = await this.prisma.choreAssignment.findMany({ where, take: CLEANUP_BATCH, select: { id: true, proofImageUrl: true } });
      if (batch.length === 0) break;
      for (const a of batch) {
        const publicId = publicIdFromUrl(a.proofImageUrl!);
        if (publicId) await this.cloudinary.destroy(publicId);
        await this.prisma.choreAssignment.updateMany({ where: { id: a.id, proofImageUrl: a.proofImageUrl }, data: { proofImageUrl: null } });
        cleaned++;
      }
    }
    return cleaned;
  }

  // ---- Khóa tuần & ca mồ côi ----

  /** Lịch của tuần đã bắt đầu: PUBLISHED → LOCKED. */
  async lockStartedWeeks(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    const { count } = await this.prisma.weekSchedule.updateMany({
      where: { status: 'PUBLISHED', weekStart: { lte: dateOf(toDateStr(now)) }, ...(houseIds ? { houseId: { in: houseIds } } : {}) },
      data: { status: 'LOCKED' },
    });
    return count;
  }

  /** Giao lại ca TODO tương lai của người đã rời nhà (S-18) cho các nhà đang có ca mồ côi. */
  async reassignOrphansAll(now: Date = new Date()): Promise<number> {
    const houses = await this.prisma.choreAssignment.findMany({
      where: { status: 'TODO', dueAt: { gt: now }, assignee: { leftAt: { not: null } } },
      distinct: ['houseId'],
      select: { houseId: true },
    });
    let moved = 0;
    for (const h of houses) moved += (await this.schedule.reassignOrphans(h.houseId, now)).moved;
    return moved;
  }

  // ---- Lịch chạy (bỏ qua ở môi trường test) ----

  private async guarded(name: string, job: () => Promise<unknown>) {
    if (this.isTest) return;
    try {
      await job();
    } catch (e) {
      this.logger.error(`Job ${name} thất bại`, e as Error);
    }
  }

  @Cron('0 20 * * 0', { timeZone: TIME_ZONE })
  cronGenerateNextWeek() {
    return this.guarded('generateNextWeek', () => this.generateNextWeek());
  }

  @Cron('*/5 * * * *', { timeZone: TIME_ZONE })
  cronMarkMissed() {
    return this.guarded('markMissed', () => this.markMissed());
  }

  @Cron('*/15 * * * *', { timeZone: TIME_ZONE })
  cronAutoApprove() {
    return this.guarded('autoApprove', () => this.autoApprove());
  }

  /** Nợ ca quá hạn chọn bù thì tự chọn giúp (spec 5.7). */
  async autoPickPayback(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    return this.payback.autoPick(now, houseIds);
  }

  @Cron('*/15 * * * *', { timeZone: TIME_ZONE })
  cronAutoPickPayback() {
    return this.guarded('autoPickPayback', () => this.autoPickPayback());
  }

  @Cron('*/10 * * * *', { timeZone: TIME_ZONE })
  cronReassignOrphans() {
    return this.guarded('reassignOrphans', () => this.reassignOrphansAll());
  }

  @Cron('0 3 * * *', { timeZone: TIME_ZONE })
  async cronCleanupProofs() {
    await this.guarded('cleanupProofs', () => this.cleanupProofs());
    await this.guarded('cleanupActivities', () => this.activity.cleanup());
  }

  @Cron('5 0 * * *', { timeZone: TIME_ZONE })
  cronLockStartedWeeks() {
    return this.guarded('lockStartedWeeks', () => this.lockStartedWeeks());
  }
}

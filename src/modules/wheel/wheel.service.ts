import { HttpStatus, Injectable, Logger, NotFoundException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { coded } from '../../common/coded-exception.js';
import type { Env } from '../../config/env.validation.js';
import type { LuckyWheelLog } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { AuditService } from '../chores/audit.service.js';
import { dateOf, type Db } from '../chores/schedule-context.js';
import { openAtOf, toDateStr, weekKeyFromStart, weekStartOf } from '../chores/week.js';
import { actorOfUser } from '../events/actor.js';
import { EventsService } from '../events/events.service.js';
import type { HouseMembership } from '../houses/guards/house-member.guard.js';
import { defaultDueKey, dueOptions, isDueValid } from './algorithms/due.js';
import { buildSlices, pickLandingIndex, pickWinner } from './algorithms/wheel.js';
import type { SpinWheelDto, WheelOptionsDto, WheelPersonDto, WheelSpinDto } from './dto/wheel.dto.js';

/** Tên việc hệ thống giữ mọi ca vòng quay của một nhà (đặc tả #5 mục 12.1). */
export const SYSTEM_CHORE_TITLE = 'Việc đột xuất';
export const SPIN_DURATION_MS = 6_000;
/** Bánh xe bắt đầu chạy sau từng này để mọi máy kịp nhận `wheel:spinning`. */
export const START_DELAY_MS = 300;
export const MAX_PER_HOUR = 5;
export const MAX_PER_DAY = 10;
/** `GET /wheel/current` còn trả vòng vừa xong trong từng này. */
const RECENT_MS = 60_000;
const HOUR = 3_600_000;

type Tx = Db;

@Injectable()
export class WheelService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WheelService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Đổi được trong test để không phải chờ 6 giây. */
  durationMs = SPIN_DURATION_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---- Vòng đời ----

  /** Server khởi động lại giữa vòng (deploy, Render ngủ): hoàn tất / hẹn lại các vòng dang dở. */
  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    void this.recoverPending().catch((e: unknown) => this.logger.error('Khôi phục vòng quay dang dở thất bại', e as Error));
  }

  onModuleDestroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  async recoverPending(now: Date = new Date()): Promise<number> {
    const pending = await this.prisma.luckyWheelLog.findMany({ where: { status: 'SPINNING' }, select: { id: true, revealAt: true } });
    for (const p of pending) {
      if (p.revealAt <= now) await this.reveal(p.id);
      else this.scheduleReveal(p.id, p.revealAt);
    }
    return pending.length;
  }

  private scheduleReveal(spinId: string, revealAt: Date) {
    clearTimeout(this.timers.get(spinId));
    const t = setTimeout(
      () => {
        this.timers.delete(spinId);
        void this.reveal(spinId).catch((e: unknown) => this.logger.error(`Công bố vòng quay ${spinId} thất bại`, e as Error));
      },
      Math.max(0, revealAt.getTime() - Date.now()),
    );
    t.unref?.();
    this.timers.set(spinId, t);
  }

  // ---- Đọc ----

  async options(houseId: string, now: Date = new Date()): Promise<WheelOptionsDto> {
    const today = toDateStr(now);
    const [members, absent, onBreak, busy, remaining] = await Promise.all([
      this.activeMembers(this.prisma, houseId),
      this.absentUserIds(this.prisma, houseId, today),
      this.onBreak(this.prisma, houseId, today),
      this.prisma.luckyWheelLog.findFirst({ where: { houseId, status: 'SPINNING', revealAt: { gt: now } }, select: { id: true } }),
      this.remaining(this.prisma, houseId, now),
    ]);
    const opts = dueOptions(now);
    return {
      members: members.map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl, absentToday: absent.has(m.id) })),
      defaultParticipantIds: members.filter((m) => !absent.has(m.id)).map((m) => m.id),
      dueOptions: opts,
      defaultDueKey: defaultDueKey(opts),
      remaining,
      houseOnBreak: onBreak,
      busySpinId: busy?.id ?? null,
      serverNow: now,
    };
  }

  /** Vòng đang quay, hoặc vừa xong trong 60 giây (vào giữa chừng / nối lại). null nếu không có. */
  async current(houseId: string, now: Date = new Date()): Promise<WheelSpinDto | null> {
    const log = await this.prisma.luckyWheelLog.findFirst({
      where: { houseId, OR: [{ status: 'SPINNING' }, { status: 'REVEALED', revealAt: { gt: new Date(now.getTime() - RECENT_MS) } }] },
      orderBy: { spunAt: 'desc' },
    });
    return log ? this.toDto(this.prisma, log, now) : null;
  }

  async history(houseId: string, limit = 20, now: Date = new Date()): Promise<WheelSpinDto[]> {
    const logs = await this.prisma.luckyWheelLog.findMany({ where: { houseId }, orderBy: { spunAt: 'desc' }, take: limit });
    const out: WheelSpinDto[] = [];
    for (const log of logs) out.push(await this.toDto(this.prisma, log, now));
    return out;
  }

  // ---- Quay ----

  /**
   * Một transaction: khóa advisory theo nhà → kiểm tra người tham gia / vắng / nghỉ / vòng đang chạy / hạn mức →
   * server chọn người trúng (`crypto.randomInt`) → ghi `LuckyWheelLog` + ca `WHEEL`. Commit xong mới phát
   * `wheel:spinning` và hẹn giờ công bố. Cùng `Idempotency-Key` thì trả lại vòng cũ (`created: false`).
   */
  async spin(
    m: HouseMembership,
    dto: SpinWheelDto,
    idempotencyKey: string | undefined,
    now: Date = new Date(),
  ): Promise<{ created: boolean; spin: WheelSpinDto }> {
    if (!idempotencyKey || idempotencyKey.length > 100) {
      throw coded(HttpStatus.BAD_REQUEST, 'IDEMPOTENCY_KEY_REQUIRED', 'Thiếu Idempotency-Key, tải lại trang rồi thử lại.');
    }
    const replay = await this.findReplay(this.prisma, m, idempotencyKey);
    if (replay) return { created: false, spin: await this.toDto(this.prisma, replay, now) };

    if (!isDueValid(now, dto.dueAt)) {
      throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'WHEEL_DUE_INVALID', 'Hạn chót phải cách bây giờ từ 30 phút đến 48 giờ.');
    }
    const participantIds = dto.participantIds;
    if (new Set(participantIds).size !== participantIds.length) {
      throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'PARTICIPANT_DUPLICATE', 'Danh sách người tham gia bị trùng.');
    }

    const outbox = this.events.outbox();
    const actor = await actorOfUser(this.prisma, m.userId);
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${m.houseId}::text))::text`;
        const again = await this.findReplay(tx, m, idempotencyKey);
        if (again) return { created: false, log: again };

        // So với `now` lúc request tới (chụp trước khi chờ khóa): vòng kia có thể đã REVEALED trong lúc chờ,
        // nhưng request vẫn tới khi bánh xe đang quay nên vẫn tính là bận. Vòng bị hủy thì không chặn.
        const busy = await tx.luckyWheelLog.findFirst({
          where: { houseId: m.houseId, status: { not: 'VOIDED' }, revealAt: { gt: now } },
          orderBy: { revealAt: 'desc' },
        });
        if (busy) {
          throw coded(HttpStatus.CONFLICT, 'WHEEL_BUSY', 'Đang có một vòng quay khác, đợi chút nhé.', {
            retryAfterMs: busy.revealAt.getTime() - now.getTime(),
            spinId: busy.id,
          });
        }
        const left = await this.remaining(tx, m.houseId, now);
        if (left.hour <= 0 || left.day <= 0) {
          throw coded(
            HttpStatus.TOO_MANY_REQUESTS,
            'WHEEL_RATE_LIMIT',
            left.day <= 0 ? `Nhà đã quay đủ ${MAX_PER_DAY} vòng hôm nay.` : `Mỗi giờ chỉ quay tối đa ${MAX_PER_HOUR} vòng, đợi chút nhé.`,
          );
        }

        const today = toDateStr(now);
        if (await this.onBreak(tx, m.houseId, today)) {
          throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'WHEEL_HOUSE_BREAK', 'Cả nhà đang nghỉ hôm nay nên không quay được.');
        }
        const members = await this.activeMembers(tx, m.houseId);
        const absent = await this.absentUserIds(tx, m.houseId, today);
        const eligible = members.filter((x) => !absent.has(x.id));
        if (eligible.length < 2) {
          throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'WHEEL_NEEDS_2_ELIGIBLE', 'Cần ít nhất 2 người để quay. Mời thêm bạn bằng mã mời nhé!');
        }
        const memberIds = new Set(members.map((x) => x.id));
        if (participantIds.some((id) => !memberIds.has(id))) {
          throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'PARTICIPANT_NOT_MEMBER', 'Có người không còn ở trong nhà, tải lại danh sách nhé.');
        }
        if (participantIds.some((id) => absent.has(id))) {
          throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'PARTICIPANT_ABSENT', 'Có người đang vắng hôm nay nên không tham gia được.');
        }
        if (participantIds.length < 2) {
          throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'WHEEL_NEEDS_2_ELIGIBLE', 'Chọn ít nhất 2 người để quay.');
        }

        // Server chọn người trúng; seed chỉ để xáo lát và vẽ.
        const winnerId = pickWinner(participantIds);
        const seed = randomInt(1, 2 ** 31 - 1);
        const slices = buildSlices(participantIds, seed);
        const landingIndex = pickLandingIndex(slices, winnerId);

        const chore =
          (await tx.chore.findFirst({ where: { houseId: m.houseId, isSystem: true }, select: { id: true } })) ??
          (await tx.chore.create({
            data: { houseId: m.houseId, title: SYSTEM_CHORE_TITLE, frequency: 'ADHOC', recurrenceDays: [], weight: 1, isSystem: true },
            select: { id: true },
          }));
        const winnerMember = await tx.houseMember.findFirstOrThrow({ where: { houseId: m.houseId, userId: winnerId, leftAt: null }, select: { id: true } });
        const last = await tx.choreAssignment.findFirst({
          where: { choreId: chore.id, occurrenceDate: dateOf(today) },
          orderBy: { slotIndex: 'desc' },
          select: { slotIndex: true },
        });
        const weekStart = weekStartOf(today);
        const assignment = await tx.choreAssignment.create({
          data: {
            houseId: m.houseId,
            choreId: chore.id,
            assigneeId: winnerMember.id,
            originalAssigneeId: winnerMember.id,
            weekKey: weekKeyFromStart(weekStart),
            weekStart: dateOf(weekStart),
            occurrenceDate: dateOf(today),
            slotIndex: (last?.slotIndex ?? -1) + 1,
            dueAt: dto.dueAt,
            titleSnapshot: dto.taskTitle,
            // Cột bắt buộc; ca vòng quay không tính tải (Q2).
            weightSnapshot: 1,
            source: 'WHEEL',
            status: 'TODO',
          },
          select: { id: true },
        });

        const spunAt = new Date(now.getTime() + START_DELAY_MS);
        const log = await tx.luckyWheelLog.create({
          data: {
            houseId: m.houseId,
            spunById: m.userId,
            taskTitle: dto.taskTitle,
            dueAt: dto.dueAt,
            participantIds,
            excludedCount: eligible.filter((x) => !participantIds.includes(x.id)).length,
            slices,
            selectedUserId: winnerId,
            assignmentId: assignment.id,
            seed,
            landingIndex,
            spunAt,
            durationMs: this.durationMs,
            revealAt: new Date(spunAt.getTime() + this.durationMs),
            idempotencyKey,
          },
        });
        return { created: true, log };
      },
      { timeout: 20_000, maxWait: 20_000 },
    );

    const spin = await this.toDto(this.prisma, result.log, now);
    if (result.created) {
      outbox.toHouse(m.houseId, 'wheel:spinning', spin, actor).flush();
      this.scheduleReveal(result.log.id, result.log.revealAt);
    }
    return { created: result.created, spin };
  }

  /**
   * Bánh xe dừng: SPINNING → REVEALED, ghi Live Ticker, phát `wheel:result`. Chạy lại không sao
   * (chỉ vòng còn SPINNING mới được công bố). Trả true nếu vừa công bố.
   */
  async reveal(spinId: string): Promise<boolean> {
    clearTimeout(this.timers.get(spinId));
    this.timers.delete(spinId);
    const outbox = this.events.outbox();
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.luckyWheelLog.updateMany({ where: { id: spinId, status: 'SPINNING' }, data: { status: 'REVEALED' } });
      if (count === 0) return false;
      const log = await tx.luckyWheelLog.findUniqueOrThrow({ where: { id: spinId } });
      const dto = await this.toDto(tx, log, new Date());
      const actor = { userId: dto.spunBy.id, name: dto.spunBy.name };
      await this.activity.record(tx, outbox, {
        houseId: log.houseId,
        type: 'wheel.result',
        actor,
        params: {
          spinId: log.id,
          taskTitle: log.taskTitle,
          participantIds: dto.participants.map((p) => p.id),
          participantNames: dto.participants.map((p) => p.name),
          excludedCount: log.excludedCount,
          winnerUserId: dto.winner!.id,
          winnerName: dto.winner!.name,
        },
        dedupeKey: `wheel:${log.id}`,
      });
      outbox.toHouse(
        log.houseId,
        'wheel:result',
        {
          spinId: log.id,
          taskTitle: log.taskTitle,
          winnerId: dto.winner!.id,
          winnerName: dto.winner!.name,
          assignmentId: log.assignmentId,
          dueAt: log.dueAt,
          winnerSlotsToday: dto.winnerSlotsToday,
        },
        actor,
      );
      return true;
    });
    outbox.flush();
    return done;
  }

  // ---- Hủy vòng (Admin) ----

  /** Gõ sai tên việc…: Admin hủy vòng khi ca còn TODO, chưa check-in. Ca → CANCELLED, vòng vẫn tính hạn mức. */
  async void(userId: string, spinId: string, reason: string): Promise<WheelSpinDto> {
    const found = await this.prisma.luckyWheelLog.findUnique({ where: { id: spinId } });
    if (!found) throw new NotFoundException('Không tìm thấy vòng quay.');
    const membership = await this.prisma.houseMember.findFirst({ where: { houseId: found.houseId, userId, leftAt: null }, select: { id: true, role: true } });
    if (!membership) throw new NotFoundException('Không tìm thấy vòng quay.');
    if (membership.role !== 'ADMIN') throw coded(HttpStatus.FORBIDDEN, 'ADMIN_ONLY', 'Chỉ trưởng phòng mới hủy được vòng quay.');

    const actor = await actorOfUser(this.prisma, userId);
    const outbox = this.events.outbox();
    const log = await this.prisma.$transaction(async (tx) => {
      // Khóa dòng ca: hai Admin hủy cùng lúc thì người sau thấy ca đã CANCELLED.
      await tx.$queryRaw`SELECT id FROM chore_assignments WHERE id = ${found.assignmentId}::uuid FOR UPDATE`;
      const [current, a] = await Promise.all([
        tx.luckyWheelLog.findUniqueOrThrow({ where: { id: spinId } }),
        tx.choreAssignment.findUniqueOrThrow({ where: { id: found.assignmentId }, select: { status: true, submittedAt: true } }),
      ]);
      if (current.status === 'VOIDED' || a.status !== 'TODO' || a.submittedAt) {
        throw coded(HttpStatus.CONFLICT, 'ASSIGNMENT_STATE_CHANGED', 'Ca này đã được nộp, đổi trạng thái hoặc đã hủy rồi.');
      }
      await tx.choreAssignment.update({ where: { id: found.assignmentId }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      const updated = await tx.luckyWheelLog.update({ where: { id: spinId }, data: { status: 'VOIDED', voidedById: userId, voidReason: reason } });
      await this.audit.log(found.houseId, membership.id, 'WHEEL_VOID', { spinId, taskTitle: found.taskTitle, reason }, { assignmentId: found.assignmentId }, tx);
      // Không kèm lý do lên ticker.
      await this.activity.record(tx, outbox, {
        houseId: found.houseId,
        type: 'wheel.voided',
        actor,
        params: { spinId, taskTitle: found.taskTitle },
        dedupeKey: `wheel-void:${spinId}`,
      });
      outbox.toHouse(found.houseId, 'wheel:voided', { spinId, taskTitle: found.taskTitle, byName: actor.name }, actor);
      outbox.toHouse(found.houseId, 'chore:cancelled', { assignmentIds: [found.assignmentId] }, actor);
      return updated;
    });
    clearTimeout(this.timers.get(spinId));
    this.timers.delete(spinId);
    outbox.flush();
    return this.toDto(this.prisma, log, new Date());
  }

  // ---- nội bộ ----

  private findReplay(db: Tx, m: HouseMembership, idempotencyKey: string) {
    return db.luckyWheelLog.findUnique({
      where: { houseId_spunById_idempotencyKey: { houseId: m.houseId, spunById: m.userId, idempotencyKey } },
    });
  }

  private async activeMembers(db: Tx, houseId: string): Promise<WheelPersonDto[]> {
    const rows = await db.houseMember.findMany({
      where: { houseId, leftAt: null },
      orderBy: { joinedAt: 'asc' },
      select: { user: { select: { id: true, fullName: true, avatarUrl: true } } },
    });
    return rows.map((r) => ({ id: r.user.id, name: r.user.fullName, avatarUrl: r.user.avatarUrl }));
  }

  private async absentUserIds(db: Tx, houseId: string, today: string): Promise<Set<string>> {
    const rows = await db.memberAbsence.findMany({
      where: { houseId, startDate: { lte: dateOf(today) }, endDate: { gte: dateOf(today) } },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  private async onBreak(db: Tx, houseId: string, today: string): Promise<boolean> {
    return (await db.houseBreak.count({ where: { houseId, startDate: { lte: dateOf(today) }, endDate: { gte: dateOf(today) } } })) > 0;
  }

  /** Lượt còn lại trong giờ / trong ngày (giờ nhà). Vòng bị hủy vẫn tính. */
  private async remaining(db: Tx, houseId: string, now: Date): Promise<{ hour: number; day: number }> {
    const [hour, day] = await Promise.all([
      db.luckyWheelLog.count({ where: { houseId, spunAt: { gt: new Date(now.getTime() - HOUR) } } }),
      db.luckyWheelLog.count({ where: { houseId, spunAt: { gte: openAtOf(toDateStr(now)) } } }),
    ]);
    return { hour: Math.max(0, MAX_PER_HOUR - hour), day: Math.max(0, MAX_PER_DAY - day) };
  }

  private async toDto(db: Tx, log: LuckyWheelLog, now: Date): Promise<WheelSpinDto> {
    const ids = [...new Set([log.spunById, ...log.participantIds])];
    const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, avatarUrl: true } });
    const person = (id: string): WheelPersonDto => {
      const u = users.find((x) => x.id === id);
      return { id, name: u?.fullName ?? 'Thành viên cũ', avatarUrl: u?.avatarUrl ?? null };
    };
    const revealed = log.status !== 'SPINNING';
    let winnerSlotsToday = 0;
    if (revealed) {
      const a = await db.choreAssignment.findUnique({ where: { id: log.assignmentId }, select: { assigneeId: true, occurrenceDate: true } });
      if (a?.assigneeId) {
        winnerSlotsToday = await db.choreAssignment.count({
          where: { assigneeId: a.assigneeId, occurrenceDate: a.occurrenceDate, id: { not: log.assignmentId }, status: { notIn: ['CANCELLED', 'UNASSIGNED'] } },
        });
      }
    }
    return {
      spinId: log.id,
      taskTitle: log.taskTitle,
      dueAt: log.dueAt,
      status: log.status,
      spunBy: person(log.spunById),
      participants: log.participantIds.map(person),
      excludedCount: log.excludedCount,
      slices: log.slices,
      landingIndex: log.landingIndex,
      seed: log.seed,
      startAt: log.spunAt,
      durationMs: log.durationMs,
      revealAt: log.revealAt,
      serverNow: now,
      winner: revealed ? person(log.selectedUserId) : null,
      assignmentId: revealed ? log.assignmentId : null,
      winnerSlotsToday,
      voidReason: log.voidReason,
    };
  }
}

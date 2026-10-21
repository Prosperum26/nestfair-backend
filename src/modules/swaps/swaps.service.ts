import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { coded } from '../../common/coded-exception.js';
import type { ChoreAssignment, ChoreSwapRequest } from '../../generated/prisma/client.js';
import type { Compensation, HouseRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { EventsService, type Outbox } from '../events/events.service.js';
import { actorOfMember } from '../events/actor.js';
import { AuditService } from '../chores/audit.service.js';
import { SwapLifecycleService } from './swap-lifecycle.service.js';
import { dateOf, type Db, dsOf } from '../chores/schedule-context.js';
import { dueAtOf, toDateStr, weekStartFromKey } from '../chores/week.js';
import { expiresAtFor } from './algorithms/swap-rules.js';
import type { CreateSwapDto } from './dto/create-swap.dto.js';
import type { SwapDto, SwapSlotDto } from './dto/swap-response.dto.js';
import { ChoreDebtService } from './chore-debt.service.js';
import { closeSwap } from './swap-close.js';
import { fillMessage, SWAP_ERRORS } from './swap-errors.js';
import {
  contextWindow,
  coverWarnings,
  evaluateCover,
  evaluateExchange,
  exchangeWarnings,
  loadSwapContext,
  type Violation,
} from './swap-validator.js';

const TX = { timeout: 10_000, maxWait: 10_000 } as const;
const HOUR = 3_600_000;
const PENDING_LIMIT = 3;
const DAILY_LIMIT = 10;
const COOLDOWN_REJECTIONS = 2;
const COOLDOWN_MS = 24 * HOUR;
/** Vi phạm chỉ nói về người nhận, không phải về ca (dùng cho Chợ ca). */
const ACCEPTOR_ONLY = new Set(['TARGET_ABSENT', 'TARGET_LEFT', 'DUPLICATE_CHORE_SAME_DAY', 'SWAP_SELF']);

export interface Actor {
  id: string;
  houseId: string;
  userId: string;
  role: HouseRole;
}

/** Lỗi nghiệp vụ ném bên trong transaction để rollback; chuyển thành `coded()` ở ngoài. */
class SwapRejection extends Error {
  constructor(
    readonly http: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
  toHttp() {
    return coded(this.http as HttpStatus, this.code, this.message, this.extra);
  }
}

const rejection = (code: string, vars: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  new SwapRejection(SWAP_ERRORS[code].status, code, fillMessage(SWAP_ERRORS[code].message, vars), extra);
const fromViolation = (v: Violation) => new SwapRejection(v.http, v.code, v.message, v.reasonCode ? { reasonCode: v.reasonCode } : {});

type AcceptOutcome =
  | { kind: 'OK'; swap: ChoreSwapRequest }
  | { kind: 'REPLAY'; swap: ChoreSwapRequest }
  | { kind: 'REJECT'; rejection: SwapRejection };

const slotSummary = (s: ChoreAssignment) => ({ id: s.id, choreTitle: s.titleSnapshot, occurrenceDate: dsOf(s.occurrenceDate), dueAt: s.dueAt });

@Injectable()
export class SwapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly activity: ActivityService,
    private readonly audit: AuditService,
    private readonly lifecycle: SwapLifecycleService,
    private readonly debts: ChoreDebtService,
  ) {}

  // ---------------------------------------------------------------- tạo

  /**
   * Tạo yêu cầu (spec 5.1). Cùng `Idempotency-Key` của cùng người thì trả lại yêu cầu cũ (`created: false`).
   * Mọi `throw` sau khi transaction đã rollback; sự kiện chỉ phát sau commit.
   */
  async create(m: Actor, dto: CreateSwapDto, idemKey: string, now: Date = new Date()): Promise<{ created: boolean; swap: SwapDto }> {
    const outbox = this.events.outbox();
    let out: { created: boolean; swap: ChoreSwapRequest };
    try {
      out = await this.prisma.$transaction((tx) => this.createInTx(tx, m, dto, idemKey, now, outbox), TX);
    } catch (e) {
      if (e instanceof SwapRejection) throw e.toHttp();
      throw e;
    }
    if (out.created) outbox.flush();
    return { created: out.created, swap: (await this.present([out.swap], m))[0] };
  }

  private async createInTx(tx: Db, m: Actor, dto: CreateSwapDto, idemKey: string, now: Date, outbox: Outbox) {
    const exchange = dto.type === 'EXCHANGE';
    const ids = (exchange ? [dto.fromAssignmentId, dto.toAssignmentId!] : [dto.fromAssignmentId]).sort();
    await this.lockAssignments(tx, m.houseId, ids);

    // Kiểm replay sau khi đã giữ khóa ca: request trùng key đến sau sẽ thấy yêu cầu của request trước.
    const prior = await tx.choreSwapRequest.findUnique({ where: { requesterMemberId_createIdemKey: { requesterMemberId: m.id, createIdemKey: idemKey } } });
    if (prior) return { created: false, swap: prior };

    const rows = await tx.choreAssignment.findMany({ where: { id: { in: ids }, houseId: m.houseId } });
    const from = rows.find((r) => r.id === dto.fromAssignmentId);
    const to = exchange ? rows.find((r) => r.id === dto.toAssignmentId) : undefined;
    if (!from || (exchange && !to)) throw new SwapRejection(HttpStatus.NOT_FOUND, 'ASSIGNMENT_NOT_FOUND', 'Không tìm thấy ca trực.');
    if (from.assigneeId !== m.id) throw new SwapRejection(HttpStatus.FORBIDDEN, 'NOT_SLOT_OWNER', 'Đây không phải ca của bạn.');

    const win = contextWindow(to ? [from, to] : [from]);
    const ctx = await loadSwapContext(tx, m.houseId, win.from, win.to);
    const id = randomUUID();

    let violations: Violation[];
    let required: string[];
    let targetMemberId: string | null;
    let compensation: Compensation | null = null;
    if (to) {
      const input = { requesterMemberId: m.id, from, to, now, phase: 'create' as const };
      violations = evaluateExchange(ctx, input);
      required = exchangeWarnings(ctx, input);
      targetMemberId = to.assigneeId;
    } else {
      compensation = dto.compensation!;
      targetMemberId = dto.targetMemberId ?? null;
      const input = { requesterMemberId: m.id, from, targetMemberId, compensation, rewardAmount: dto.rewardAmount ?? null, now, phase: 'create' as const };
      violations = evaluateCover(ctx, input);
      required = coverWarnings(ctx, input);
    }
    if (violations.length) throw fromViolation(violations[0]);

    await this.assertWithinLimits(tx, m, from.id, targetMemberId, now, targetMemberId ? ctx.members.get(targetMemberId)?.name ?? '' : '');

    const acknowledged = new Set(dto.acknowledgedWarnings ?? []);
    if (required.some((w) => !acknowledged.has(w))) throw rejection('WARNINGS_NOT_ACKNOWLEDGED', {}, { warnings: required });

    const locked = await tx.swapLock.createMany({
      data: ids.map((assignmentId) => ({ assignmentId, swapRequestId: id })),
      skipDuplicates: true,
    });
    if (locked.count !== ids.length) throw rejection('SLOT_LOCKED');

    const gift = compensation === 'GIFT';
    const swap = await tx.choreSwapRequest.create({
      data: {
        id,
        houseId: m.houseId,
        type: dto.type,
        requesterMemberId: m.id,
        targetMemberId,
        fromAssignmentId: from.id,
        toAssignmentId: to?.id ?? null,
        compensation,
        rewardNote: gift ? dto.rewardNote || null : null,
        rewardAmount: gift ? dto.rewardAmount ?? null : null,
        reason: dto.reason || null,
        note: targetMemberId ? dto.note || null : null,
        expiresAt: expiresAtFor(dto.type, now, to ? [from.dueAt, to.dueAt] : [from.dueAt]),
        rootRequestId: id,
        fromWeightSnapshot: from.weightSnapshot,
        toWeightSnapshot: to?.weightSnapshot ?? null,
        fromVersion: from.version,
        toVersion: to?.version ?? null,
        createIdemKey: idemKey,
      },
    });

    // Payload chỉ là tín hiệu để client tải lại: không mang lý do, lời nhắn hay số tiền.
    const payload = {
      swapId: id,
      type: swap.type,
      fromAssignment: slotSummary(from),
      requesterName: ctx.members.get(m.id)?.name,
      market: targetMemberId === null,
      hasReward: gift && (swap.rewardAmount !== null || !!swap.rewardNote),
      expiresAt: swap.expiresAt,
    };
    if (targetMemberId) outbox.toUser(ctx.members.get(targetMemberId)!.userId, 'swap:requested', payload, { houseId: m.houseId });
    else outbox.toHouse(m.houseId, 'swap:requested', payload);
    return { created: true, swap };
  }

  /** R-SWAP-12: tối đa 3 PENDING, 10 yêu cầu mỗi ngày, và khóa gửi lại 24 giờ sau 2 lần bị từ chối cùng ca, cùng người. */
  private async assertWithinLimits(tx: Db, m: Actor, fromId: string, targetMemberId: string | null, now: Date, targetName: string) {
    const pending = await tx.choreSwapRequest.count({ where: { requesterMemberId: m.id, status: 'PENDING' } });
    if (pending >= PENDING_LIMIT) throw rejection('SWAP_PENDING_LIMIT');
    const today = await tx.choreSwapRequest.count({ where: { requesterMemberId: m.id, createdAt: { gte: dueAtOf(toDateStr(now), '00:00') } } });
    if (today >= DAILY_LIMIT) throw rejection('SWAP_DAILY_LIMIT');
    if (!targetMemberId) return;
    const rejected = await tx.choreSwapRequest.findMany({
      where: { requesterMemberId: m.id, targetMemberId, fromAssignmentId: fromId, status: 'REJECTED' },
      orderBy: { closedAt: 'desc' },
      take: COOLDOWN_REJECTIONS,
      select: { closedAt: true },
    });
    const last = rejected[0]?.closedAt;
    if (rejected.length >= COOLDOWN_REJECTIONS && last && now.getTime() - last.getTime() < COOLDOWN_MS) {
      throw rejection('SWAP_TARGET_COOLDOWN', { Tên: targetName });
    }
  }

  // ------------------------------------------------------------ chấp nhận

  /**
   * Chấp nhận (spec 5.2). Transaction chỉ TRẢ KẾT QUẢ; mọi `throw` và mọi `emit` nằm ngoài, để việc đóng yêu cầu
   * (hết hạn, ca đã đổi) được commit chứ không bị rollback cùng lỗi.
   */
  async accept(m: Actor, swapId: string, idemKey: string, now: Date = new Date()): Promise<{ swap: SwapDto; alreadyDone: boolean }> {
    const outbox = this.events.outbox();
    const out = await this.prisma.$transaction((tx) => this.acceptInTx(tx, m, swapId, idemKey, now, outbox), TX);
    outbox.flush();
    if (out.kind === 'REJECT') throw out.rejection.toHttp();
    return { swap: (await this.present([out.swap], m))[0], alreadyDone: out.kind === 'REPLAY' };
  }

  private async acceptInTx(tx: Db, m: Actor, swapId: string, idemKey: string, now: Date, outbox: Outbox): Promise<AcceptOutcome> {
    // COVER + PAYBACK có thể cấn trừ sổ nợ: lấy khóa nhà trước (cùng khóa và cùng thứ tự với chọn ca bù, tha nợ,
    // auto-pick, xáo lịch) rồi mới khóa yêu cầu, để không deadlock và không cấn trừ trùng một khoản nợ.
    const peek = await tx.choreSwapRequest.findUnique({ where: { id: swapId }, select: { houseId: true, type: true, compensation: true } });
    if (peek && peek.houseId === m.houseId && peek.type === 'COVER' && peek.compensation === 'PAYBACK') {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${m.houseId}::text))::text`;
    }
    await tx.$queryRaw`SELECT id FROM chore_swap_requests WHERE id = ${swapId}::uuid FOR UPDATE`;
    const swap = await tx.choreSwapRequest.findUnique({ where: { id: swapId } });
    if (!swap || swap.houseId !== m.houseId) {
      return { kind: 'REJECT', rejection: new SwapRejection(HttpStatus.NOT_FOUND, 'SWAP_NOT_FOUND', 'Không tìm thấy yêu cầu đổi ca.') };
    }

    if (swap.acceptIdemKey === idemKey && swap.acceptedById === m.id) return { kind: 'REPLAY', swap };
    if (swap.status !== 'PENDING') {
      const code = swap.status === 'ACCEPTED' && swap.targetMemberId === null ? 'SWAP_ALREADY_ACCEPTED' : 'SWAP_NOT_PENDING';
      return { kind: 'REJECT', rejection: rejection(code) };
    }

    if (swap.expiresAt.getTime() <= now.getTime()) {
      await this.expireInTx(tx, swap, outbox);
      return { kind: 'REJECT', rejection: rejection('SWAP_EXPIRED') };
    }

    if (swap.targetMemberId !== null && swap.targetMemberId !== m.id) {
      return { kind: 'REJECT', rejection: rejection('NOT_SWAP_TARGET') };
    }
    if (swap.targetMemberId === null && swap.requesterMemberId === m.id) {
      return { kind: 'REJECT', rejection: rejection('CANNOT_ACCEPT_OWN') };
    }

    if (swap.type === 'PERMANENT' || !swap.fromAssignmentId) throw new Error(`Loại yêu cầu ${swap.type} chưa hỗ trợ ở bước này.`);
    const ids = [swap.fromAssignmentId, swap.toAssignmentId].filter((x): x is string => !!x).sort();
    await this.lockAssignments(tx, m.houseId, ids);
    const slots = await tx.choreAssignment.findMany({ where: { id: { in: ids } } });
    const from = slots.find((s) => s.id === swap.fromAssignmentId);
    const to = slots.find((s) => s.id === swap.toAssignmentId);

    const stale = this.staleReason(swap, from, to);
    let problem: SwapRejection | null = stale ? rejection('SLOT_CHANGED', {}, { reasonCode: stale }) : null;
    if (!problem && from) {
      const win = contextWindow(to ? [from, to] : [from]);
      const ctx = await loadSwapContext(tx, m.houseId, win.from, win.to, swap.id);
      const violations = to
        ? evaluateExchange(ctx, { requesterMemberId: swap.requesterMemberId, from, to, now, phase: 'accept' })
        : evaluateCover(ctx, {
            requesterMemberId: swap.requesterMemberId,
            from,
            targetMemberId: m.id,
            compensation: swap.compensation ?? 'GIFT',
            rewardAmount: swap.rewardAmount,
            now,
            phase: 'accept',
          });
      // Chợ ca: vi phạm chỉ liên quan tới người bấm nhận (vắng, đã có ca cùng việc) thì từ chối riêng người đó,
      // không đóng yêu cầu của người khác. Vi phạm về chính ca thì đóng như mọi yêu cầu khác.
      if (swap.targetMemberId === null && violations.length && violations.every((v) => ACCEPTOR_ONLY.has(v.code))) {
        return { kind: 'REJECT', rejection: fromViolation(violations[0]) };
      }
      if (violations.length) problem = new SwapRejection(409, 'SLOT_CHANGED', violations[0].message, { reasonCode: violations[0].code });
    }
    if (problem) {
      await this.closeSwap(tx, swap, 'CANCELLED', 'SLOT_CHANGED');
      const users = await this.memberUsers(tx, [swap.requesterMemberId, swap.targetMemberId]);
      const payload = { swapId: swap.id, resolution: 'SLOT_CHANGED' };
      if (swap.targetMemberId === null) outbox.toHouse(swap.houseId, 'swap:cancelled', payload);
      else for (const u of users.values()) outbox.toUser(u.userId, 'swap:cancelled', payload, { houseId: swap.houseId });
      return { kind: 'REJECT', rejection: problem };
    }

    // Áp dụng. Luôn giữ originalAssigneeId; tăng version; ghi yêu cầu đã tạo ra `source` hiện tại.
    const bump = { swapRequestId: swap.id, version: { increment: 1 } } as const;
    let debtEvent: { debtId: string } | null = null;
    let paidDebtIds: string[] = [];
    let offsetDebtId: string | null = null;
    if (to) {
      await tx.choreAssignment.update({ where: { id: from!.id }, data: { assigneeId: to.assigneeId, source: 'SWAP', ...bump } });
      await tx.choreAssignment.update({ where: { id: to.id }, data: { assigneeId: from!.assigneeId, source: 'SWAP', ...bump } });
    } else {
      await tx.choreAssignment.update({ where: { id: from!.id }, data: { assigneeId: m.id, source: 'COVER', ...bump } });
      if (swap.compensation === 'PAYBACK') {
        const res = await this.debts.offsetOrCreate(tx, swap, m.id);
        if (res.created) debtEvent = { debtId: res.created.id };
        paidDebtIds = res.paidDebtIds;
        offsetDebtId = res.offsetDebtIds[0] ?? null;
      }
    }
    const closed = await this.closeSwap(tx, swap, 'ACCEPTED', 'ACCEPTED_BY_TARGET', { acceptedById: m.id, acceptedAt: now, acceptIdemKey: idemKey, offsetDebtId });

    const actor = await actorOfMember(tx, m.id);
    const users = await this.memberUsers(tx, [swap.requesterMemberId]);
    const requesterName = users.get(swap.requesterMemberId)?.name ?? '';
    const hasReward = swap.rewardAmount !== null || !!swap.rewardNote;
    await this.activity.record(tx, outbox, {
      houseId: swap.houseId,
      type: 'swap.accepted',
      actor,
      // Ticker chỉ ghi "kèm quà", không ghi số tiền hay ghi chú.
      params: { swapId: swap.id, type: swap.type, requesterName, choreTitles: [from!.titleSnapshot, ...(to ? [to.titleSnapshot] : [])], hasReward },
      dedupeKey: `swap.accepted:${swap.id}`,
    });
    outbox.toHouse(swap.houseId, 'swap:accepted', { swapId: swap.id, type: swap.type, acceptedByName: actor.name, changedAssignmentIds: ids }, actor);
    if (debtEvent) {
      outbox.toHouse(swap.houseId, 'chore_debt:created', { debtId: debtEvent.debtId, debtorName: requesterName, creditorName: actor.name }, actor);
    }
    for (const debtId of paidDebtIds) outbox.toHouse(swap.houseId, 'chore_debt:paid', { debtId }, actor);
    return { kind: 'OK', swap: closed };
  }

  /** So trạng thái hiện tại của các ca với lúc tạo yêu cầu (spec 5.2 bước 5). */
  private staleReason(swap: ChoreSwapRequest, from?: ChoreAssignment, to?: ChoreAssignment): string | null {
    if (!from || (swap.toAssignmentId && !to)) return 'SLOT_GONE';
    if (from.assigneeId !== swap.requesterMemberId) return 'ASSIGNEE_CHANGED';
    if (to && to.assigneeId !== swap.targetMemberId) return 'ASSIGNEE_CHANGED';
    if (from.status !== 'TODO' || (to && to.status !== 'TODO')) return 'STATUS_CHANGED';
    if (from.version !== swap.fromVersion || (to && to.version !== swap.toVersion)) return 'VERSION_CHANGED';
    return null;
  }

  // --------------------------------------------------- từ chối và hủy

  /** Người nhận đích danh từ chối. */
  async reject(m: Actor, swapId: string, reason: string | undefined, now: Date = new Date()): Promise<SwapDto> {
    const outbox = this.events.outbox();
    const out = await this.prisma.$transaction(async (tx) => {
      const swap = await this.lockSwap(tx, m, swapId);
      if (swap instanceof SwapRejection) return swap;
      if (swap.status !== 'PENDING') return rejection('SWAP_NOT_PENDING');
      if (swap.targetMemberId !== m.id) return rejection('NOT_SWAP_TARGET');
      if (swap.expiresAt.getTime() <= now.getTime()) {
        await this.expireInTx(tx, swap, outbox);
        return rejection('SWAP_EXPIRED');
      }
      const closed = await this.closeSwap(tx, swap, 'REJECTED', 'REJECTED_BY_TARGET', { rejectReason: reason || null });
      const users = await this.memberUsers(tx, [swap.requesterMemberId]);
      outbox.toUser(users.get(swap.requesterMemberId)!.userId, 'swap:rejected', { swapId: swap.id }, { houseId: swap.houseId });
      return closed;
    }, TX);
    outbox.flush();
    if (out instanceof SwapRejection) throw out.toHttp();
    return (await this.present([out], m))[0];
  }

  /** Người gửi hủy khi còn PENDING. */
  async cancel(m: Actor, swapId: string): Promise<SwapDto> {
    const outbox = this.events.outbox();
    const out = await this.prisma.$transaction(async (tx) => {
      const swap = await this.lockSwap(tx, m, swapId);
      if (swap instanceof SwapRejection) return swap;
      if (swap.requesterMemberId !== m.id) return rejection('NOT_REQUESTER');
      if (swap.status !== 'PENDING') return rejection('SWAP_NOT_PENDING');
      const closed = await this.closeSwap(tx, swap, 'CANCELLED', 'CANCELLED_BY_REQUESTER');
      const payload = { swapId: swap.id, resolution: 'CANCELLED_BY_REQUESTER' };
      if (swap.targetMemberId === null) outbox.toHouse(swap.houseId, 'swap:cancelled', payload);
      else for (const u of (await this.memberUsers(tx, [swap.requesterMemberId, swap.targetMemberId])).values()) outbox.toUser(u.userId, 'swap:cancelled', payload, { houseId: swap.houseId });
      return closed;
    }, TX);
    outbox.flush();
    if (out instanceof SwapRejection) throw out.toHttp();
    return (await this.present([out], m))[0];
  }

  /** Admin hủy mọi yêu cầu PENDING của một tuần (SW-34), ghi nhật ký. */
  async cancelPendingInWeek(m: Actor, weekKey: string): Promise<{ cancelled: number }> {
    const weekStart = dateOf(weekStartFromKey(weekKey));
    const outbox = this.events.outbox();
    const ids = await this.prisma.$transaction(async (tx) => {
      const cancelled = await this.lifecycle.cancelPendingInWeek(tx, outbox, m.houseId, weekStart, 'ADMIN_OVERRIDE');
      if (cancelled.length) await this.audit.log(m.houseId, m.id, 'CANCEL_PENDING_SWAPS', { weekKey, swapIds: cancelled }, {}, tx);
      return cancelled;
    }, TX);
    outbox.flush();
    return { cancelled: ids.length };
  }

  // ------------------------------------------------------------ danh sách

  /**
   * Danh sách theo phạm vi. Lọc `expiresAt > now` nên yêu cầu quá hạn mà cron chưa chạy không hiện ra.
   * OUTGOING còn giữ yêu cầu vừa hết hạn đang chờ người gửi chọn leo thang. MARKET sắp theo hạn gần nhất (D13).
   */
  async list(m: Actor, scope: 'INCOMING' | 'OUTGOING' | 'MARKET', now: Date = new Date()): Promise<SwapDto[]> {
    const live = { houseId: m.houseId, status: 'PENDING' as const, expiresAt: { gt: now } };
    const where =
      scope === 'INCOMING'
        ? { ...live, targetMemberId: m.id }
        : scope === 'MARKET'
          ? { ...live, targetMemberId: null }
          : {
              houseId: m.houseId,
              requesterMemberId: m.id,
              OR: [{ status: 'PENDING' as const, expiresAt: { gt: now } }, { status: 'EXPIRED' as const, escalationChoice: null, escalationDeadline: { gt: now } }],
            };
    const rows = await this.prisma.choreSwapRequest.findMany({
      where,
      orderBy: scope === 'MARKET' ? [{ expiresAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
    });
    const dtos = await this.present(rows, m);
    if (scope !== 'MARKET') return dtos;
    const eligibility = await this.marketEligibility(m, rows, now);
    for (const d of dtos) d.eligibility = eligibility.get(d.id);
    return dtos;
  }

  /** Người xem có nhận giúp được từng yêu cầu Chợ ca không, và nếu không thì vì sao. */
  private async marketEligibility(m: Actor, rows: ChoreSwapRequest[], now: Date) {
    const out = new Map<string, { canAccept: boolean; reasonCode?: string; reasonText?: string }>();
    const slots = await this.prisma.choreAssignment.findMany({ where: { id: { in: rows.map((r) => r.fromAssignmentId).filter((x): x is string => !!x) } } });
    if (!slots.length) return out;
    const win = contextWindow(slots);
    const ctx = await loadSwapContext(this.prisma, m.houseId, win.from, win.to);
    ctx.lockedIds = new Set(); // khóa của chính yêu cầu Chợ ca không được tính là vướng
    for (const r of rows) {
      const from = slots.find((s) => s.id === r.fromAssignmentId);
      if (!from) continue;
      if (r.requesterMemberId === m.id) {
        const spec = SWAP_ERRORS.CANNOT_ACCEPT_OWN;
        out.set(r.id, { canAccept: false, reasonCode: 'CANNOT_ACCEPT_OWN', reasonText: spec.message });
        continue;
      }
      const v = evaluateCover(ctx, { requesterMemberId: r.requesterMemberId, from, targetMemberId: m.id, compensation: r.compensation ?? 'GIFT', now, phase: 'accept' });
      out.set(r.id, v.length ? { canAccept: false, reasonCode: v[0].code, reasonText: v[0].message } : { canAccept: true });
    }
    return out;
  }

  /** Số đếm cho widget Dashboard (khớp độ dài các danh sách tương ứng). */
  async summary(m: Actor, now: Date = new Date()) {
    const live = { houseId: m.houseId, status: 'PENDING' as const, expiresAt: { gt: now } };
    const [incoming, market, debtsOwedByMe, debtsOwedToMe] = await Promise.all([
      this.prisma.choreSwapRequest.count({ where: { ...live, targetMemberId: m.id } }),
      this.prisma.choreSwapRequest.count({ where: { ...live, targetMemberId: null } }),
      this.prisma.choreDebt.count({ where: { houseId: m.houseId, debtorMemberId: m.id, status: 'OPEN' } }),
      this.prisma.choreDebt.count({ where: { houseId: m.houseId, creditorMemberId: m.id, status: 'OPEN' } }),
    ]);
    return { incoming, market, debtsOwedByMe, debtsOwedToMe };
  }

  // ------------------------------------------------------------ dùng chung

  /** Xem `closeSwap` (swap-close.ts). */
  closeSwap(...args: Parameters<typeof closeSwap>): ReturnType<typeof closeSwap> {
    return closeSwap(...args);
  }

  /**
   * Yêu cầu đã quá `expiresAt` mà cron chưa chạy, bị phát hiện lúc có người bấm: đóng EXPIRED như cron.
   * COVER: người gửi còn đến `dueAt − 1h` để chọn leo thang (spec 5.6).
   */
  private async expireInTx(tx: Db, swap: ChoreSwapRequest, outbox: Outbox): Promise<void> {
    const coverSlot = swap.type === 'COVER' && swap.fromAssignmentId ? await tx.choreAssignment.findUnique({ where: { id: swap.fromAssignmentId }, select: { dueAt: true } }) : null;
    const expired = await this.closeSwap(tx, swap, 'EXPIRED', 'EXPIRED_NO_TAKER', coverSlot ? { escalationDeadline: new Date(coverSlot.dueAt.getTime() - HOUR) } : {});
    this.notifyExpired(outbox, await this.memberUsers(tx, [swap.requesterMemberId]), expired);
  }

  private async lockSwap(tx: Db, m: Actor, swapId: string): Promise<ChoreSwapRequest | SwapRejection> {
    await tx.$queryRaw`SELECT id FROM chore_swap_requests WHERE id = ${swapId}::uuid FOR UPDATE`;
    const swap = await tx.choreSwapRequest.findUnique({ where: { id: swapId } });
    if (!swap || swap.houseId !== m.houseId) return new SwapRejection(HttpStatus.NOT_FOUND, 'SWAP_NOT_FOUND', 'Không tìm thấy yêu cầu đổi ca.');
    return swap;
  }

  /** Khóa dòng ca theo id tăng dần (tránh deadlock, spec 3.4). Chỉ khóa ca của đúng nhà. */
  private async lockAssignments(tx: Db, houseId: string, sortedIds: string[]): Promise<void> {
    await tx.$queryRaw`SELECT id FROM chore_assignments WHERE id = ANY(${sortedIds}::uuid[]) AND "houseId" = ${houseId}::uuid ORDER BY id FOR UPDATE`;
  }

  private async memberUsers(tx: Db, memberIds: (string | null)[]) {
    const ids = [...new Set(memberIds.filter((x): x is string => !!x))];
    const rows = await tx.houseMember.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true, user: { select: { fullName: true } } } });
    return new Map(rows.map((r) => [r.id, { userId: r.userId, name: r.user.fullName }]));
  }

  private notifyExpired(outbox: Outbox, users: Map<string, { userId: string; name: string }>, swap: ChoreSwapRequest) {
    const requester = users.get(swap.requesterMemberId);
    if (requester) outbox.toUser(requester.userId, 'swap:expired', { swapId: swap.id, escalationDeadline: swap.escalationDeadline }, { houseId: swap.houseId });
  }

  /** Chuyển dòng DB thành DTO. Lý do và lời nhắn chỉ hiện cho người gửi, người nhận và Admin (D5). */
  async present(rows: ChoreSwapRequest[], viewer: Pick<Actor, 'id' | 'role'>, db: Db = this.prisma): Promise<SwapDto[]> {
    if (!rows.length) return [];
    const slotIds = [...new Set(rows.flatMap((r) => [r.fromAssignmentId, r.toAssignmentId]).filter((x): x is string => !!x))];
    const slots = await db.choreAssignment.findMany({ where: { id: { in: slotIds } } });
    const slotById = new Map(slots.map((s) => [s.id, s]));
    const users = await this.memberUsers(db, rows.flatMap((r) => [r.requesterMemberId, r.targetMemberId]));
    const dto = (s: ChoreAssignment | undefined): SwapSlotDto | null =>
      s ? { ...slotSummary(s), weight: s.weightSnapshot, assigneeId: s.assigneeId } : null;
    return rows.map((r) => {
      const involved = viewer.id === r.requesterMemberId || viewer.id === r.targetMemberId || viewer.role === 'ADMIN';
      return {
        id: r.id,
        type: r.type,
        status: r.status,
        resolution: r.resolution,
        requesterMemberId: r.requesterMemberId,
        requesterName: users.get(r.requesterMemberId)?.name ?? '',
        targetMemberId: r.targetMemberId,
        targetName: r.targetMemberId ? users.get(r.targetMemberId)?.name ?? null : null,
        fromAssignment: dto(r.fromAssignmentId ? slotById.get(r.fromAssignmentId) : undefined),
        toAssignment: dto(r.toAssignmentId ? slotById.get(r.toAssignmentId) : undefined),
        compensation: r.compensation,
        rewardNote: r.rewardNote,
        rewardAmount: r.rewardAmount,
        reason: involved ? r.reason : null,
        note: involved ? r.note : null,
        rejectReason: involved ? r.rejectReason : null,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
        acceptedAt: r.acceptedAt,
        rootRequestId: r.rootRequestId,
        market: r.targetMemberId === null,
      };
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { ChoreAssignment } from '../../generated/prisma/client.js';
import type { Compensation } from '../../generated/prisma/enums.js';
import { COUNTED_STATUSES, type Db, dsOf } from '../chores/schedule-context.js';
import { addDays } from '../chores/week.js';
import {
  inGrace,
  isUrgentCover,
  slotSwapSource,
  tooLateToRequest,
  weightWarnings,
  type SwapWarning,
} from './algorithms/swap-rules.js';
import { fillMessage, SWAP_ERRORS } from './swap-errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Violation {
  code: string;
  http: number;
  message: string;
  /** Chi tiết cho `SLOT_NOT_SWAPPABLE`: PENDING_VERIFY, REJECTED, IN_GRACE, MISSED, DONE, CANCELLED. */
  reasonCode?: string;
}

/** Dữ liệu nhà đọc một lần để kiểm nhiều ứng viên mà không truy vấn lặp lại. */
export interface SwapContext {
  graceHours: number;
  maxSlotsPerDay: number;
  activeCount: number;
  members: Map<string, { id: string; userId: string; name: string; leftAt: Date | null }>;
  absences: { userId: string; start: string; end: string }[];
  lockedIds: Set<string>;
  /** Ca trong cửa sổ đang xét (dùng cho trùng việc, trần ngày, rào, ngày liền). */
  slots: ChoreAssignment[];
  rotationModeOf: Map<string, string>;
}

/** `create`: mọi quy tắc cứng. `accept`: chỉ các quy tắc về trạng thái ca, người và trùng việc (spec 5.2 bước 5). */
export type SwapPhase = 'create' | 'accept';

export interface ExchangeInput {
  requesterMemberId: string;
  from: ChoreAssignment;
  to: ChoreAssignment;
  now: Date;
  phase?: SwapPhase;
}

export interface CoverInput {
  requesterMemberId: string;
  from: ChoreAssignment;
  /** null = Chợ ca. */
  targetMemberId: string | null;
  compensation: Compensation;
  rewardAmount?: number | null;
  now: Date;
  phase?: SwapPhase;
}

const STATE_COPY: Record<string, string> = {
  PENDING_VERIFY: 'Ca đã có ảnh chờ duyệt nên không đổi được nữa.',
  IN_GRACE: 'Ca đã quá hạn. Hãy nộp ảnh trước khi hết ân hạn.',
  MISSED: 'Ca đã quá hạn nên không đổi được nữa.',
  DONE: 'Ca đã hoàn thành nên không đổi được.',
  REJECTED: 'Ca đang bị yêu cầu làm lại nên không đổi được.',
  CANCELLED: 'Ca này không còn trong lịch.',
};

function violation(code: string, vars: Record<string, string> = {}, reasonCode?: string): Violation {
  const spec = SWAP_ERRORS[code];
  const message = reasonCode && STATE_COPY[reasonCode] ? STATE_COPY[reasonCode] : fillMessage(spec.message, vars);
  return { code, http: spec.status, message, ...(reasonCode ? { reasonCode } : {}) };
}

class Collector {
  readonly list: Violation[] = [];
  private readonly seen = new Set<string>();
  add(v: Violation) {
    const key = `${v.code}:${v.reasonCode ?? ''}:${v.message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(v);
  }
}

const dd = (ds: string) => `${ds.slice(8, 10)}.${ds.slice(5, 7)}`;
const counts = (s: ChoreAssignment) => (COUNTED_STATUSES as readonly string[]).includes(s.status);

/** Đọc dữ liệu nhà cho các ca có tuần nằm trong [from, to]. */
export async function loadSwapContext(
  tx: Db,
  houseId: string,
  from: Date,
  to: Date,
  /** Bỏ qua khóa của chính yêu cầu này (kiểm lại lúc accept không được tự vướng khóa của mình). */
  ignoreSwapId?: string,
): Promise<SwapContext> {
  const [house, members, absences, slots] = await Promise.all([
    tx.house.findUniqueOrThrow({ where: { id: houseId }, select: { choreGraceHours: true, maxSlotsPerPersonPerDay: true } }),
    tx.houseMember.findMany({ where: { houseId }, select: { id: true, userId: true, leftAt: true, user: { select: { fullName: true } } } }),
    tx.memberAbsence.findMany({
      where: { houseId, endDate: { gte: from }, startDate: { lte: to } },
      select: { userId: true, startDate: true, endDate: true },
    }),
    tx.choreAssignment.findMany({ where: { houseId, weekStart: { gte: from, lte: to } } }),
  ]);
  const locks = await tx.swapLock.findMany({
    where: { assignmentId: { in: slots.map((s) => s.id) }, ...(ignoreSwapId ? { swapRequestId: { not: ignoreSwapId } } : {}) },
    select: { assignmentId: true },
  });
  const choreIds = [...new Set(slots.map((s) => s.choreId))];
  const chores = await tx.chore.findMany({ where: { id: { in: choreIds } }, select: { id: true, rotationMode: true } });
  return {
    graceHours: house.choreGraceHours,
    maxSlotsPerDay: house.maxSlotsPerPersonPerDay,
    activeCount: members.filter((m) => !m.leftAt).length,
    members: new Map(members.map((m) => [m.id, { id: m.id, userId: m.userId, name: m.user.fullName, leftAt: m.leftAt }])),
    absences: absences.map((a) => ({ userId: a.userId, start: dsOf(a.startDate), end: dsOf(a.endDate) })),
    lockedIds: new Set(locks.map((l) => l.assignmentId)),
    slots,
    rotationModeOf: new Map(chores.map((c) => [c.id, c.rotationMode])),
  };
}

/** Cửa sổ tuần cần đọc để kiểm các ca đã cho (cộng 3 tuần lịch sử cho cảnh báo rào). */
export function contextWindow(slots: ChoreAssignment[]): { from: Date; to: Date } {
  const times = slots.map((s) => s.weekStart.getTime());
  return { from: new Date(Math.min(...times) - 21 * DAY_MS), to: new Date(Math.max(...times) + 7 * DAY_MS) };
}

const nameOf = (ctx: SwapContext, memberId: string | null): string => (memberId ? ctx.members.get(memberId)?.name ?? 'Người này' : 'Người này');

function absentOn(ctx: SwapContext, memberId: string, date: string): boolean {
  const userId = ctx.members.get(memberId)?.userId;
  return !!userId && ctx.absences.some((a) => a.userId === userId && a.start <= date && date <= a.end);
}

function stateViolation(ctx: SwapContext, slot: ChoreAssignment, now: Date): Violation | null {
  if (!slot.assigneeId || slot.status === 'UNASSIGNED' || slot.status === 'CANCELLED') {
    return violation('SLOT_NOT_SWAPPABLE', {}, 'CANCELLED');
  }
  if (slot.status === 'TODO') {
    if (now.getTime() <= slot.dueAt.getTime()) return null;
    return violation('SLOT_NOT_SWAPPABLE', {}, inGrace(now, slot.dueAt, ctx.graceHours) ? 'IN_GRACE' : 'MISSED');
  }
  return violation('SLOT_NOT_SWAPPABLE', {}, slot.status);
}

/** Người nhận sẽ có ca cùng việc, cùng ngày, ngoài các ca đang đổi ra? */
function hasSameChoreThatDay(ctx: SwapContext, memberId: string, incoming: ChoreAssignment, outgoingId: string): boolean {
  return ctx.slots.some(
    (s) =>
      s.id !== outgoingId &&
      s.id !== incoming.id &&
      s.assigneeId === memberId &&
      s.choreId === incoming.choreId &&
      s.occurrenceDate.getTime() === incoming.occurrenceDate.getTime() &&
      counts(s),
  );
}

function sourceViolations(slot: ChoreAssignment, kind: 'exchange' | 'cover', compensation?: Compensation): Violation | null {
  const info = slotSwapSource(slot.source);
  if (slot.source === 'PAYBACK') return violation('PAYBACK_SLOT_LOCKED');
  if (slot.source === 'WHEEL') {
    if (kind === 'exchange' || compensation === 'PAYBACK') return violation('WHEEL_NOT_EXCHANGEABLE');
    return null;
  }
  if (kind === 'cover' && !info.cover) return violation('COVER_CHAIN_FORBIDDEN');
  if (kind === 'exchange' && !info.exchange) return violation('SLOT_NOT_SWAPPABLE');
  return null;
}

/** Kiểm ràng buộc cứng cho EXCHANGE (R-SWAP-1 … 4, 8 … 11, 13). Thứ tự vi phạm theo mức ưu tiên. */
export function evaluateExchange(ctx: SwapContext, input: ExchangeInput): Violation[] {
  const { requesterMemberId, from, to, now } = input;
  const creating = (input.phase ?? 'create') === 'create';
  const out = new Collector();
  if (creating && ctx.activeCount < 2) out.add(violation('SWAP_NEEDS_2_MEMBERS'));
  if (to.assigneeId === requesterMemberId) out.add(violation('SWAP_SELF'));
  if (from.id === to.id || (from.choreId === to.choreId && from.occurrenceDate.getTime() === to.occurrenceDate.getTime())) {
    out.add(violation('SWAP_IDENTICAL_SLOT'));
  }
  if (ctx.lockedIds.has(from.id) || ctx.lockedIds.has(to.id)) out.add(violation('SLOT_LOCKED'));
  for (const s of [from, to]) {
    const state = stateViolation(ctx, s, now);
    if (state) out.add(state);
  }
  for (const s of [from, to]) {
    const src = sourceViolations(s, 'exchange');
    if (src) out.add(src);
  }
  const target = to.assigneeId ? ctx.members.get(to.assigneeId) : undefined;
  if (to.assigneeId && (!target || target.leftAt)) out.add(violation('TARGET_LEFT', { Tên: nameOf(ctx, to.assigneeId) }));
  if (to.assigneeId && target && !target.leftAt && absentOn(ctx, to.assigneeId, dsOf(from.occurrenceDate))) {
    out.add(violation('TARGET_ABSENT', { Tên: target.name, 'dd.mm': dd(dsOf(from.occurrenceDate)) }));
  }
  if (absentOn(ctx, requesterMemberId, dsOf(to.occurrenceDate))) {
    out.add(violation('TARGET_ABSENT', { Tên: nameOf(ctx, requesterMemberId), 'dd.mm': dd(dsOf(to.occurrenceDate)) }));
  }
  if (from.weekStart.getTime() !== to.weekStart.getTime()) out.add(violation('WEEK_MISMATCH'));
  if (creating && tooLateToRequest(now, [from.dueAt, to.dueAt])) out.add(violation('SWAP_TOO_LATE'));
  if (hasSameChoreThatDay(ctx, requesterMemberId, to, from.id)) {
    out.add(violation('DUPLICATE_CHORE_SAME_DAY', { Tên: nameOf(ctx, requesterMemberId), Việc: to.titleSnapshot }));
  }
  if (to.assigneeId && hasSameChoreThatDay(ctx, to.assigneeId, from, to.id)) {
    out.add(violation('DUPLICATE_CHORE_SAME_DAY', { Tên: nameOf(ctx, to.assigneeId), Việc: from.titleSnapshot }));
  }
  return out.list;
}

/** Kiểm ràng buộc cứng cho COVER (R-SWAP-1 … 5, 8, 9, 11, 13, 14). */
export function evaluateCover(ctx: SwapContext, input: CoverInput): Violation[] {
  const { requesterMemberId, from, targetMemberId, compensation, now } = input;
  const out = new Collector();
  if (ctx.activeCount < 2) out.add(violation('SWAP_NEEDS_2_MEMBERS'));
  if (targetMemberId && targetMemberId === requesterMemberId) out.add(violation('SWAP_SELF'));
  if (ctx.lockedIds.has(from.id)) out.add(violation('SLOT_LOCKED'));
  const state = stateViolation(ctx, from, now);
  if (state) out.add(state);
  const src = sourceViolations(from, 'cover', compensation);
  if (src) out.add(src);
  const amount = input.rewardAmount ?? null;
  if (amount !== null && (compensation !== 'GIFT' || !Number.isInteger(amount) || amount < 1000 || amount > 500_000 || amount % 1000 !== 0)) {
    out.add(violation('REWARD_OUT_OF_RANGE'));
  }
  if (tooLateToRequest(now, [from.dueAt])) out.add(violation('SWAP_TOO_LATE'));
  if (targetMemberId && isUrgentCover(now, from.dueAt)) out.add(violation('URGENT_MARKET_ONLY'));
  if (targetMemberId && targetMemberId !== requesterMemberId) {
    const target = ctx.members.get(targetMemberId);
    if (!target || target.leftAt) {
      out.add(violation('TARGET_LEFT', { Tên: nameOf(ctx, targetMemberId) }));
    } else {
      if (absentOn(ctx, targetMemberId, dsOf(from.occurrenceDate))) {
        out.add(violation('TARGET_ABSENT', { Tên: target.name, 'dd.mm': dd(dsOf(from.occurrenceDate)) }));
      }
      if (hasSameChoreThatDay(ctx, targetMemberId, from, from.id)) {
        out.add(violation('DUPLICATE_CHORE_SAME_DAY', { Tên: target.name, Việc: from.titleSnapshot }));
      }
    }
  }
  return out.list;
}

/** Cảnh báo mềm W-1 … W-5 cho việc `receiver` nhận `incoming` (và nhả `outgoing` nếu là EXCHANGE). */
function receiverFlags(ctx: SwapContext, receiverMemberId: string | null, incoming: ChoreAssignment, outgoing: ChoreAssignment | null) {
  if (!receiverMemberId) return { fenceRepeat: false, overDailyCap: false, consecutiveDay: false };
  const mine = ctx.slots.filter((s) => s.assigneeId === receiverMemberId && counts(s) && s.id !== outgoing?.id && s.id !== incoming.id);
  const weekMs = incoming.weekStart.getTime();
  const fenceRepeat = mine.some(
    (s) => s.choreId === incoming.choreId && s.weekStart.getTime() < weekMs && s.weekStart.getTime() >= weekMs - 14 * DAY_MS,
  );
  const sameDay = mine.filter((s) => s.occurrenceDate.getTime() === incoming.occurrenceDate.getTime()).length;
  const overDailyCap = sameDay + 1 > ctx.maxSlotsPerDay;
  const date = dsOf(incoming.occurrenceDate);
  const around = new Set([addDays(date, -1), addDays(date, 1)]);
  const consecutiveDay =
    ctx.rotationModeOf.get(incoming.choreId) === 'PER_OCCURRENCE' &&
    mine.some((s) => s.choreId === incoming.choreId && around.has(dsOf(s.occurrenceDate)));
  return { fenceRepeat, overDailyCap, consecutiveDay };
}

export function exchangeWarnings(ctx: SwapContext, input: ExchangeInput): SwapWarning[] {
  const { requesterMemberId, from, to, now } = input;
  const a = receiverFlags(ctx, requesterMemberId, to, from);
  const b = receiverFlags(ctx, to.assigneeId, from, to);
  return weightWarnings({
    weightA: from.weightSnapshot,
    weightB: to.weightSnapshot,
    minDueAt: new Date(Math.min(from.dueAt.getTime(), to.dueAt.getTime())),
    now,
    fenceRepeat: a.fenceRepeat || b.fenceRepeat,
    overDailyCap: a.overDailyCap || b.overDailyCap,
    consecutiveDay: a.consecutiveDay || b.consecutiveDay,
  });
}

export function coverWarnings(ctx: SwapContext, input: CoverInput): SwapWarning[] {
  const flags = receiverFlags(ctx, input.targetMemberId, input.from, null);
  return weightWarnings({
    weightA: input.from.weightSnapshot,
    weightB: null,
    minDueAt: input.from.dueAt,
    now: input.now,
    ...flags,
  });
}

/**
 * Kiểm hợp lệ có DB cho đổi ca. Hàm `evaluate*` ở trên là phần thuần (dùng chung với `SwapOptionsService`
 * để đọc dữ liệu nhà một lần); hai hàm `check*` dưới đây đọc ngữ cảnh rồi kiểm, dùng khi tạo và khi accept.
 */
@Injectable()
export class SwapValidator {
  async checkExchange(tx: Db, input: ExchangeInput): Promise<Violation[]> {
    const { from, to } = contextWindow([input.from, input.to]);
    const ctx = await loadSwapContext(tx, input.from.houseId, from, to);
    return evaluateExchange(ctx, input);
  }

  async checkCover(tx: Db, input: CoverInput): Promise<Violation[]> {
    const { from, to } = contextWindow([input.from]);
    const ctx = await loadSwapContext(tx, input.from.houseId, from, to);
    return evaluateCover(ctx, input);
  }
}

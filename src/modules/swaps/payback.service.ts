import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { ChoreAssignment, ChoreDebt } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../chores/audit.service.js';
import { dateOf, type Db, dsOf } from '../chores/schedule-context.js';
import { COUNTED_STATUSES } from '../chores/schedule-context.js';
import { addDays, dueAtOf, weekStartOf } from '../chores/week.js';
import { type Outbox, EventsService } from '../events/events.service.js';
import { actorOfMember } from '../events/actor.js';
import type { PaybackOptionDto, PaybackOptionsDto, PaybackResultDto } from './dto/payback.dto.js';
import { fillMessage, SWAP_ERRORS } from './swap-errors.js';
import { MAX_PICK_ATTEMPTS, PICK_WINDOW_HOURS } from './chore-debt.service.js';
import { paybackReason, pickAuto, type DebtorState, type PaybackSlot, validPaybackSlots } from './payback-pick.js';

const HOUR = 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX = { timeout: 15_000, maxWait: 15_000 } as const;

interface Actor {
  id: string;
  houseId: string;
  userId: string;
}

const fail = (code: string, vars: Record<string, string> = {}, extra: Record<string, unknown> = {}) => {
  const spec = SWAP_ERRORS[code];
  return coded(spec.status as HttpStatus, code, fillMessage(spec.message, vars), extra);
};

/** Lần sinh lịch kế tiếp: Chủ Nhật 20:00 giờ nhà sau `now`. */
export function nextScheduleGenerationAt(now: Date): Date {
  const sunday = addDays(weekStartOf(now), 6);
  const at = dueAtOf(sunday, '20:00');
  return at.getTime() > now.getTime() ? at : dueAtOf(addDays(sunday, 7), '20:00');
}

const toPickSlot = (s: ChoreAssignment): PaybackSlot => ({
  id: s.id,
  choreId: s.choreId,
  title: s.titleSnapshot,
  weight: s.weightSnapshot,
  occurrenceDate: dsOf(s.occurrenceDate),
  weekStart: dsOf(s.weekStart),
  dueAt: s.dueAt,
  status: s.status,
  source: s.source,
});

/** Chọn ca bù, tha nợ và auto-pick. */
@Injectable()
export class PaybackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- truy cập

  /** Nợ theo id, nhà suy ra từ chính nợ. Chưa từng ở nhà đó → 404; đã rời → 403. */
  private async access(userId: string, debtId: string): Promise<{ debt: ChoreDebt; m: Actor }> {
    const notFound = () => new NotFoundException('Không tìm thấy khoản nợ.');
    if (!UUID.test(debtId)) throw notFound();
    const debt = await this.prisma.choreDebt.findUnique({ where: { id: debtId } });
    if (!debt) throw notFound();
    const active = await this.prisma.houseMember.findFirst({ where: { houseId: debt.houseId, userId, leftAt: null }, select: { id: true, houseId: true, userId: true } });
    if (active) return { debt, m: active };
    const former = await this.prisma.houseMember.findFirst({ where: { houseId: debt.houseId, userId }, select: { id: true } });
    if (!former) throw notFound();
    throw coded(HttpStatus.FORBIDDEN, 'LEFT_HOUSE', 'Bạn đã rời nhà này.');
  }

  /** Cùng khóa advisory với việc sinh lịch của `ScheduleService` (không import để tránh vòng module). */
  private async houseLock(tx: Db, houseId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${houseId}::text))::text`;
  }

  private async lockDebt(tx: Db, debtId: string): Promise<ChoreDebt> {
    await tx.$queryRaw`SELECT id FROM chore_debts WHERE id = ${debtId}::uuid FOR UPDATE`;
    return tx.choreDebt.findUniqueOrThrow({ where: { id: debtId } });
  }

  // ----------------------------------------------------------- ứng viên

  /** Đọc ca của creditor ở hai tuần kế và trạng thái của debtor để kiểm hợp lệ. */
  private async candidates(tx: Db, debt: ChoreDebt) {
    const cover = await tx.choreAssignment.findUnique({ where: { id: debt.coverAssignmentId }, select: { weekStart: true } });
    const base = cover ? dsOf(cover.weekStart) : weekStartOf(debt.createdAt);
    const w1 = addDays(base, 7);
    const w2 = addDays(base, 14);
    const rows = await tx.choreAssignment.findMany({
      where: {
        houseId: debt.houseId,
        assigneeId: debt.creditorMemberId,
        weekStart: { in: [dateOf(w1), dateOf(w2)] },
        status: { in: ['TODO', 'PENDING_VERIFY', 'REJECTED'] },
      },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    const debtor = await tx.houseMember.findUniqueOrThrow({ where: { id: debt.debtorMemberId }, select: { userId: true } });
    const [absences, debtorSlots, locks] = await Promise.all([
      tx.memberAbsence.findMany({ where: { houseId: debt.houseId, userId: debtor.userId, endDate: { gte: dateOf(w1) }, startDate: { lte: dateOf(addDays(w2, 6)) } } }),
      tx.choreAssignment.findMany({
        where: { houseId: debt.houseId, assigneeId: debt.debtorMemberId, weekStart: { in: [dateOf(w1), dateOf(w2)] }, status: { in: [...COUNTED_STATUSES] } },
        select: { choreId: true, occurrenceDate: true },
      }),
      tx.swapLock.findMany({ where: { assignmentId: { in: rows.map((r) => r.id) } }, select: { assignmentId: true } }),
    ]);
    const absentDates = new Set<string>();
    for (const a of absences) for (let d = dsOf(a.startDate); d <= dsOf(a.endDate); d = addDays(d, 1)) absentDates.add(d);
    const state = (weeks: string[]): DebtorState => ({
      absentDates,
      sameDayKeys: new Set(debtorSlots.map((s) => `${s.choreId}|${dsOf(s.occurrenceDate)}`)),
      lockedIds: new Set(locks.map((l) => l.assignmentId)),
      weekStarts: new Set(weeks),
    });
    const slots = rows.map(toPickSlot);
    /** Tuần kế tiếp trước; chỉ khi tuần đó không có ca hợp lệ nào mới cho chọn sang tuần sau nữa. */
    const weeksFor = (deadline: Date) => (validPaybackSlots(slots, deadline, state([w1])).length > 0 ? [w1] : [w1, w2]);
    return { rows, slots, state, weeksFor };
  }

  // ----------------------------------------------------------- tùy chọn

  async paybackOptions(userId: string, debtId: string, now: Date = new Date()): Promise<PaybackOptionsDto> {
    const { debt, m } = await this.access(userId, debtId);
    if (debt.creditorMemberId !== m.id) throw fail('NOT_CREDITOR');
    if (!debt.pickDeadlineAt) throw fail('PAYBACK_WINDOW_NOT_OPEN');
    const c = await this.candidates(this.prisma, debt);
    const state = c.state(c.weeksFor(debt.pickDeadlineAt));
    const options: PaybackOptionDto[] = c.slots.map((s) => {
      const reason = paybackReason(s, debt.pickDeadlineAt!, state);
      const spec = reason ? SWAP_ERRORS[reason] : null;
      return {
        assignmentId: s.id,
        choreTitle: s.title,
        occurrenceDate: s.occurrenceDate,
        dueAt: s.dueAt,
        weight: s.weight,
        weightDiff: s.weight - debt.weight,
        valid: reason === null,
        ...(reason && spec ? { reasonCode: reason, reasonText: fillMessage(spec.message, { Tên: 'Người nhận', Việc: s.title, 'dd.mm': `${s.occurrenceDate.slice(8, 10)}.${s.occurrenceDate.slice(5, 7)}` }) } : {}),
      };
    });
    void now;
    return { debtId: debt.id, weight: debt.weight, pickOpensAt: debt.pickOpensAt, pickDeadlineAt: debt.pickDeadlineAt, options };
  }

  // -------------------------------------------------------------- chọn

  /** Gán ca `slot` của creditor cho debtor: ca đổi người, `source = PAYBACK`, nợ ghi lại ca bù. */
  private async assign(tx: Db, outbox: Outbox, debt: ChoreDebt, slot: ChoreAssignment): Promise<void> {
    await tx.choreAssignment.update({
      where: { id: slot.id },
      data: { assigneeId: debt.debtorMemberId, source: 'PAYBACK', swapRequestId: debt.swapRequestId, version: { increment: 1 } },
    });
    await tx.choreDebt.update({ where: { id: debt.id }, data: { paybackAssignmentId: slot.id } });
    outbox.toHouse(debt.houseId, 'chore:reassigned', { assignmentId: slot.id, weekKey: slot.weekKey, assignmentIds: [slot.id] });
  }

  async payback(userId: string, debtId: string, assignmentId: string, _idemKey: string, now: Date = new Date()): Promise<PaybackResultDto> {
    const { debt: seen, m } = await this.access(userId, debtId);
    if (seen.creditorMemberId !== m.id) throw fail('NOT_CREDITOR');
    const outbox = this.events.outbox();
    const out = await this.prisma.$transaction(async (tx) => {
      await this.houseLock(tx, seen.houseId);
      const debt = await this.lockDebt(tx, debtId);
      if (debt.status !== 'OPEN') throw fail('DEBT_NOT_OPEN');
      if (debt.paybackAssignmentId === assignmentId) return { alreadyDone: true, debt };
      if (debt.paybackAssignmentId) throw fail('PAYBACK_ALREADY_CHOSEN');
      if (!debt.pickOpensAt || !debt.pickDeadlineAt || debt.pickOpensAt.getTime() > now.getTime()) throw fail('PAYBACK_WINDOW_NOT_OPEN');

      if (!UUID.test(assignmentId)) throw new NotFoundException('Không tìm thấy ca trực.');
      await tx.$queryRaw`SELECT id FROM chore_assignments WHERE id = ${assignmentId}::uuid AND "houseId" = ${debt.houseId}::uuid FOR UPDATE`;
      const slot = await tx.choreAssignment.findFirst({ where: { id: assignmentId, houseId: debt.houseId, assigneeId: debt.creditorMemberId } });
      if (!slot) throw new NotFoundException('Không tìm thấy ca trực của bạn.');

      const c = await this.candidates(tx, debt);
      const reason = paybackReason(toPickSlot(slot), debt.pickDeadlineAt, c.state(c.weeksFor(debt.pickDeadlineAt)));
      if (reason) throw fail(reason, { Tên: 'Người nhận', Việc: slot.titleSnapshot });
      await this.assign(tx, outbox, debt, slot);
      return { alreadyDone: false, debt: await tx.choreDebt.findUniqueOrThrow({ where: { id: debt.id } }) };
    }, TX);
    outbox.flush();
    return { debtId: out.debt.id, paybackAssignmentId: out.debt.paybackAssignmentId!, alreadyDone: out.alreadyDone };
  }

  // -------------------------------------------------------------- tha nợ

  async forgive(userId: string, debtId: string, now: Date = new Date()): Promise<{ debtId: string; status: 'FORGIVEN' }> {
    const { debt: seen, m } = await this.access(userId, debtId);
    if (seen.creditorMemberId !== m.id) throw fail('NOT_CREDITOR');
    const outbox = this.events.outbox();
    await this.prisma.$transaction(async (tx) => {
      await this.houseLock(tx, seen.houseId);
      const debt = await this.lockDebt(tx, debtId);
      if (debt.status !== 'OPEN') throw fail('DEBT_NOT_OPEN');
      if (debt.paybackAssignmentId) {
        await tx.$queryRaw`SELECT id FROM chore_assignments WHERE id = ${debt.paybackAssignmentId}::uuid FOR UPDATE`;
        const slot = await tx.choreAssignment.findUnique({ where: { id: debt.paybackAssignmentId } });
        if (slot && ['PENDING_VERIFY', 'DONE', 'REJECTED'].includes(slot.status)) throw fail('DEBT_NOT_FORGIVABLE');
        if (slot && slot.status === 'TODO') {
          await tx.choreAssignment.update({
            where: { id: slot.id },
            data: { assigneeId: debt.creditorMemberId, source: 'ROTATION', swapRequestId: null, version: { increment: 1 } },
          });
          outbox.toHouse(debt.houseId, 'chore:reassigned', { assignmentId: slot.id, weekKey: slot.weekKey, assignmentIds: [slot.id] });
        }
      }
      await tx.choreDebt.update({ where: { id: debt.id }, data: { status: 'FORGIVEN', closeReason: 'FORGIVEN_BY_CREDITOR', settledAt: now } });
      outbox.toHouse(debt.houseId, 'chore_debt:forgiven', { debtId: debt.id, closeReason: 'FORGIVEN_BY_CREDITOR' }, await actorOfMember(tx, m.id));
    }, TX);
    outbox.flush();
    return { debtId, status: 'FORGIVEN' };
  }

  // ----------------------------------------------------------- auto-pick

  /**
   * Nợ quá hạn chọn mà chưa có ca bù → tự chọn ca có độ nặng gần nhất (spec 5.4). Không có ca hợp lệ thì dời
   * cửa sổ sang lần sinh lịch kế. Trả số nợ đã được gán ca. An toàn nhiều instance: `FOR UPDATE SKIP LOCKED`.
   */
  async autoPick(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    const due = await this.prisma.choreDebt.findMany({
      where: {
        status: 'OPEN',
        paybackAssignmentId: null,
        pickAttempts: { lt: MAX_PICK_ATTEMPTS },
        pickDeadlineAt: { lte: now },
        ...(houseIds ? { houseId: { in: houseIds } } : {}),
      },
      orderBy: { id: 'asc' },
      select: { id: true, houseId: true },
      take: 200,
    });
    let picked = 0;
    for (const { id, houseId } of due) {
      const outbox = this.events.outbox();
      const done = await this.prisma.$transaction(async (tx) => {
        await this.houseLock(tx, houseId);
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM chore_debts
          WHERE id = ${id}::uuid AND status = 'OPEN' AND "paybackAssignmentId" IS NULL AND "pickDeadlineAt" <= ${now.toISOString()}::timestamp
          FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return false;
        const debt = await tx.choreDebt.findUniqueOrThrow({ where: { id } });
        const c = await this.candidates(tx, debt);
        const valid = validPaybackSlots(c.slots, debt.pickDeadlineAt!, c.state(c.weeksFor(debt.pickDeadlineAt!)));
        const bestId = pickAuto(valid, debt.weight);
        if (!bestId) {
          const pickOpensAt = nextScheduleGenerationAt(now);
          await tx.choreDebt.update({ where: { id }, data: { pickOpensAt, pickDeadlineAt: new Date(pickOpensAt.getTime() + PICK_WINDOW_HOURS * HOUR) } });
          return false;
        }
        await tx.$queryRaw`SELECT id FROM chore_assignments WHERE id = ${bestId}::uuid FOR UPDATE`;
        const slot = await tx.choreAssignment.findUniqueOrThrow({ where: { id: bestId } });
        await this.assign(tx, outbox, debt, slot);
        await this.audit.log(debt.houseId, null, 'AUTO_PICK', { debtId: debt.id, assignmentId: slot.id, weight: debt.weight }, { assignmentId: slot.id }, tx);
        return true;
      }, TX);
      if (done) {
        picked++;
        outbox.flush();
      }
    }
    return picked;
  }
}

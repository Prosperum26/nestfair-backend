import { Injectable } from '@nestjs/common';
import type { ChoreAssignment, ChoreDebt, ChoreSwapRequest } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../chores/audit.service.js';
import { dateOf, type Db, dsOf } from '../chores/schedule-context.js';
import { addDays } from '../chores/week.js';
import { EventsService, type Outbox } from '../events/events.service.js';
import type { DebtDto, DebtGroupsResponseDto, DebtPhase } from './dto/debt-response.dto.js';

const HOUR = 3_600_000;
/** Người được làm bù có 48 giờ để chọn ca (spec 5.4). */
export const PICK_WINDOW_HOURS = 48;
/** Sau bấy nhiêu lần ca bù bị bỏ lỡ thì chuyển cho Admin. */
export const MAX_PICK_ATTEMPTS = 3;
/** Nợ chưa xếp được ca bù sau bấy nhiêu ngày thì tha (4 tuần). */
export const STALE_DAYS = 28;
/** Nợ đã đóng còn hiện trong sổ bấy nhiêu ngày kể từ `settledAt`. */
export const CLOSED_VISIBLE_DAYS = 30;
/** Số nhóm tối đa trong một lần trả về. */
export const MAX_DEBT_GROUPS = 100;

/** Ca gắn lại khi xáo lịch (xem `pinsForReroll`). */
export interface RerollPin {
  debtId: string;
  kind: 'PAYBACK' | 'COVER';
  choreId: string;
  date: string;
  memberId: string;
  originalMemberId: string;
  swapRequestId: string;
}

interface Viewer {
  id: string;
}

/** Sổ nợ ca (làm bù). */
@Injectable()
export class ChoreDebtService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /**
   * COVER + PAYBACK được chấp nhận: người nhờ nợ người làm hộ đủ độ nặng của ca. Chưa cấn trừ gì ở đây: cấn trừ
   * ngược chiều (R-SWAP-7) chỉ có hiệu lực khi ca gốc DONE (D17), xem `applyOffset`.
   * `creditorMemberId` là người làm hộ (người nhận).
   */
  async createDebt(tx: Db, swap: ChoreSwapRequest, creditorMemberId: string): Promise<ChoreDebt> {
    return tx.choreDebt.create({
      data: {
        houseId: swap.houseId,
        debtorMemberId: swap.requesterMemberId,
        creditorMemberId,
        swapRequestId: swap.id,
        coverAssignmentId: swap.fromAssignmentId!,
        weight: swap.fromWeightSnapshot,
      },
    });
  }

  /**
   * Ca gốc của `debt` vừa DONE: cấn trừ với các nợ ngược chiều (người nhờ đang là chủ nợ của chính người làm hộ,
   * nợ OPEN, chưa có ca bù được chọn), cũ nhất trước (bảng 5.4). Phần được cấn trừ trừ vào cả hai phía:
   * nợ cũ đủ thì PAID (OFFSET), không đủ thì giảm weight; nợ mới hết weight thì PAID (OFFSET).
   * Trả nợ mới nếu còn lại một phần, hoặc null nếu đã cấn trừ hết.
   */
  async applyOffset(tx: Db, outbox: Outbox, debt: ChoreDebt, now: Date): Promise<ChoreDebt | null> {
    // Khóa nợ mới và các nợ cũ cùng lúc, theo thứ tự cũ nhất trước rồi đọc lại.
    await tx.$queryRaw`
      SELECT id FROM chore_debts
      WHERE "houseId" = ${debt.houseId}::uuid AND status = 'OPEN'
        AND (id = ${debt.id}::uuid OR (
          "debtorMemberId" = ${debt.creditorMemberId}::uuid AND "creditorMemberId" = ${debt.debtorMemberId}::uuid
          AND "paybackAssignmentId" IS NULL))
      ORDER BY "createdAt", id FOR UPDATE`;
    const current = await tx.choreDebt.findUniqueOrThrow({ where: { id: debt.id } });
    if (current.status !== 'OPEN') return null;
    const old = await tx.choreDebt.findMany({
      where: {
        houseId: debt.houseId,
        status: 'OPEN',
        id: { not: debt.id },
        debtorMemberId: debt.creditorMemberId,
        creditorMemberId: debt.debtorMemberId,
        paybackAssignmentId: null,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    let remaining = current.weight;
    const offsetIds: string[] = [];
    for (const d of old) {
      if (remaining <= 0) break;
      offsetIds.push(d.id);
      if (remaining >= d.weight) {
        await tx.choreDebt.update({ where: { id: d.id }, data: { status: 'PAID', closeReason: 'OFFSET', settledAt: now } });
        outbox.toHouse(d.houseId, 'chore_debt:paid', { debtId: d.id });
        remaining -= d.weight;
      } else {
        await tx.choreDebt.update({ where: { id: d.id }, data: { weight: d.weight - remaining } });
        remaining = 0;
      }
    }
    if (offsetIds.length === 0) return current;
    await tx.choreSwapRequest.updateMany({ where: { id: current.swapRequestId }, data: { offsetDebtId: offsetIds[0] } });
    if (remaining <= 0) {
      await tx.choreDebt.update({ where: { id: current.id }, data: { status: 'PAID', closeReason: 'OFFSET', settledAt: now } });
      outbox.toHouse(current.houseId, 'chore_debt:paid', { debtId: current.id });
      return null;
    }
    return tx.choreDebt.update({ where: { id: current.id }, data: { weight: remaining } });
  }

  /**
   * Mở cửa sổ chọn bù: `pickOpensAt = max(lịch tuần kế được sinh, bây giờ)`, hạn chọn sau 48 giờ.
   * Chỉ báo `chore_debt:pick_requested` cho người được làm bù khi cửa sổ đã mở.
   */
  async openPickWindow(tx: Db, outbox: Outbox | null, debt: ChoreDebt, now: Date, nextWeekGeneratedAt: Date): Promise<void> {
    const pickOpensAt = new Date(Math.max(nextWeekGeneratedAt.getTime(), now.getTime()));
    const pickDeadlineAt = new Date(pickOpensAt.getTime() + PICK_WINDOW_HOURS * HOUR);
    await tx.choreDebt.update({ where: { id: debt.id }, data: { pickOpensAt, pickDeadlineAt } });
    if (outbox && pickOpensAt.getTime() <= now.getTime()) {
      const creditor = await tx.houseMember.findUnique({ where: { id: debt.creditorMemberId }, select: { userId: true } });
      if (creditor) outbox.toUser(creditor.userId, 'chore_debt:pick_requested', { debtId: debt.id, pickDeadlineAt }, { houseId: debt.houseId });
    }
  }

  /** Ca `assignmentId` vừa DONE: nếu là ca gốc của một nợ OPEN thì mở cửa sổ chọn bù (khi lịch tuần kế đã có). */
  async onAssignmentDone(tx: Db, outbox: Outbox, assignmentId: string, now: Date): Promise<void> {
    // Ca bù hoàn thành → nợ được trả, nhưng chỉ khi người làm xong đúng là người nợ. Nếu Admin đã giao ca bù cho
    // người khác thì việc họ làm xong không trả nợ của người nợ.
    const paid = await tx.choreDebt.findMany({ where: { paybackAssignmentId: assignmentId, status: 'OPEN' } });
    if (paid.length) {
      const slot = await tx.choreAssignment.findUnique({ where: { id: assignmentId }, select: { assigneeId: true } });
      for (const d of paid) {
        if (slot?.assigneeId !== d.debtorMemberId) continue;
        await tx.choreDebt.update({ where: { id: d.id }, data: { status: 'PAID', settledAt: now } });
        outbox.toHouse(d.houseId, 'chore_debt:paid', { debtId: d.id });
      }
    }
    const debts = await tx.choreDebt.findMany({ where: { coverAssignmentId: assignmentId, status: 'OPEN', pickOpensAt: null } });
    if (!debts.length) return;
    const slot = await tx.choreAssignment.findUnique({ where: { id: assignmentId }, select: { weekStart: true } });
    if (!slot) return;
    for (const original of debts) {
      // D17: cấn trừ chỉ có hiệu lực khi ca gốc DONE; nợ đã cấn trừ hết thì không còn cửa sổ chọn bù.
      const debt = await this.applyOffset(tx, outbox, original, now);
      if (!debt) continue;
      const schedule = await tx.weekSchedule.findUnique({
        where: { houseId_weekStart: { houseId: debt.houseId, weekStart: dateOf(addDays(dsOf(slot.weekStart), 7)) } },
      });
      if (!schedule || schedule.status === 'EMPTY') continue; // chờ lịch tuần kế được sinh
      await this.openPickWindow(tx, outbox, debt, now, schedule.createdAt);
    }
  }

  /**
   * Các ca vừa bị đánh MISSED (spec 5.4):
   * - ca bù bị bỏ lỡ → nợ về OPEN, chọn lại (tối đa 2 lần); lần thứ ba chuyển cho Admin, không tự tha;
   * - ca gốc được làm hộ bị bỏ lỡ → nợ bị hủy (COVER_MISSED).
   */
  async onAssignmentsMissed(tx: Db, outbox: Outbox, assignmentIds: string[], now: Date): Promise<void> {
    if (!assignmentIds.length) return;
    const missedPaybacks = await tx.choreDebt.findMany({ where: { status: 'OPEN', paybackAssignmentId: { in: assignmentIds } } });
    for (const d of missedPaybacks) {
      const attempts = d.pickAttempts + 1;
      if (attempts >= MAX_PICK_ATTEMPTS) {
        await tx.choreDebt.update({ where: { id: d.id }, data: { pickAttempts: attempts, paybackAssignmentId: null, pickOpensAt: null, pickDeadlineAt: null } });
        await this.audit.log(d.houseId, null, 'PAYBACK_NEEDS_ADMIN', { debtId: d.id, attempts }, { assignmentId: d.paybackAssignmentId ?? undefined }, tx);
        const admins = await tx.houseMember.findMany({ where: { houseId: d.houseId, role: 'ADMIN', leftAt: null }, select: { userId: true } });
        for (const a of admins) outbox.toUser(a.userId, 'chore_debt:pick_requested', { debtId: d.id, needsAdmin: true }, { houseId: d.houseId });
        continue;
      }
      const reopened = await tx.choreDebt.update({
        where: { id: d.id },
        data: { pickAttempts: attempts, paybackAssignmentId: null, pickOpensAt: now, pickDeadlineAt: new Date(now.getTime() + PICK_WINDOW_HOURS * HOUR) },
      });
      const creditor = await tx.houseMember.findUnique({ where: { id: d.creditorMemberId }, select: { userId: true } });
      if (creditor) outbox.toUser(creditor.userId, 'chore_debt:pick_requested', { debtId: d.id, pickDeadlineAt: reopened.pickDeadlineAt }, { houseId: d.houseId });
    }
    const covered = await tx.choreDebt.findMany({ where: { status: 'OPEN', coverAssignmentId: { in: assignmentIds } } });
    for (const d of covered) {
      await tx.choreDebt.update({ where: { id: d.id }, data: { status: 'CANCELLED', closeReason: 'COVER_MISSED', settledAt: now } });
      outbox.toHouse(d.houseId, 'chore_debt:forgiven', { debtId: d.id, closeReason: 'COVER_MISSED' });
    }
  }

  /**
   * Ca bù đã chọn không còn là ca của người nợ (Admin CANCEL, hoặc hệ thống dời vì khai vắng): bỏ lựa chọn, mở lại
   * cửa sổ 48 giờ để người được làm bù chọn ca khác. `pickAttempts` không đổi (đây không phải lỗi của người nợ).
   */
  async releasePayback(tx: Db, outbox: Outbox, assignmentId: string, now: Date): Promise<number> {
    const debts = await tx.choreDebt.findMany({ where: { status: 'OPEN', paybackAssignmentId: assignmentId } });
    for (const d of debts) {
      const cleared = await tx.choreDebt.update({ where: { id: d.id }, data: { paybackAssignmentId: null } });
      await this.openPickWindow(tx, outbox, cleared, now, now);
    }
    return debts.length;
  }

  /** Ca gốc được làm hộ bị Admin hủy (COVER_MISSED) hoặc giao lại (ADMIN_REASSIGN): nợ không còn lý do tồn tại. */
  async cancelForCover(tx: Db, outbox: Outbox, assignmentId: string, now: Date, reason: 'COVER_MISSED' | 'ADMIN_REASSIGN'): Promise<number> {
    const debts = await tx.choreDebt.findMany({ where: { status: 'OPEN', coverAssignmentId: assignmentId } });
    for (const d of debts) {
      await tx.choreDebt.update({ where: { id: d.id }, data: { status: 'CANCELLED', closeReason: reason, settledAt: now } });
      outbox.toHouse(d.houseId, 'chore_debt:forgiven', { debtId: d.id, closeReason: reason });
    }
    return debts.length;
  }

  /**
   * Xáo lại lịch (D18): ca bù đã chọn (do người nợ giữ) và ca được làm hộ của nợ OPEN phải được ghim lại ở lịch mới.
   * Gọi trước khi xóa lịch cũ; trả danh sách ghim để đưa vào thuật toán rồi `applyRerollPins` sau khi lưu lịch mới.
   */
  async pinsForReroll(tx: Db, houseId: string, current: ChoreAssignment[]): Promise<RerollPin[]> {
    const byId = new Map(current.map((a) => [a.id, a]));
    const debts = await tx.choreDebt.findMany({
      where: { houseId, status: 'OPEN', OR: [{ paybackAssignmentId: { in: [...byId.keys()] } }, { coverAssignmentId: { in: [...byId.keys()] } }] },
    });
    const pins: RerollPin[] = [];
    for (const d of debts) {
      const payback = d.paybackAssignmentId ? byId.get(d.paybackAssignmentId) : undefined;
      if (payback && payback.assigneeId === d.debtorMemberId) {
        pins.push({ debtId: d.id, kind: 'PAYBACK', choreId: payback.choreId, date: dsOf(payback.occurrenceDate), memberId: d.debtorMemberId, originalMemberId: d.creditorMemberId, swapRequestId: d.swapRequestId });
      }
      const cover = byId.get(d.coverAssignmentId);
      if (cover?.assigneeId) {
        pins.push({ debtId: d.id, kind: 'COVER', choreId: cover.choreId, date: dsOf(cover.occurrenceDate), memberId: cover.assigneeId, originalMemberId: d.debtorMemberId, swapRequestId: d.swapRequestId });
      }
    }
    return pins;
  }

  /**
   * Sau khi lịch mới đã lưu: gắn lại nợ vào ca mới tương ứng (cùng việc, cùng ngày). Không giữ được ca (người đó vắng,
   * việc đã tắt…): ca bù thì mở lại để chọn, ca được làm hộ thì hủy nợ.
   */
  async applyRerollPins(tx: Db, outbox: Outbox, scheduleId: string, pins: RerollPin[], now: Date): Promise<void> {
    for (const pin of pins) {
      const row = await tx.choreAssignment.findFirst({ where: { scheduleId, choreId: pin.choreId, occurrenceDate: dateOf(pin.date), slotIndex: 0 } });
      if (row && row.assigneeId === pin.memberId) {
        await tx.choreAssignment.update({
          where: { id: row.id },
          data: { source: pin.kind, originalAssigneeId: pin.originalMemberId, swapRequestId: pin.swapRequestId },
        });
        await tx.choreDebt.update({ where: { id: pin.debtId }, data: pin.kind === 'PAYBACK' ? { paybackAssignmentId: row.id } : { coverAssignmentId: row.id } });
        continue;
      }
      if (pin.kind === 'PAYBACK') {
        const cleared = await tx.choreDebt.update({ where: { id: pin.debtId }, data: { paybackAssignmentId: null } });
        await this.openPickWindow(tx, outbox, cleared, now, now);
      } else {
        const closed = await tx.choreDebt.update({ where: { id: pin.debtId }, data: { status: 'CANCELLED', closeReason: 'ABSENT_REASSIGN', settledAt: now } });
        outbox.toHouse(closed.houseId, 'chore_debt:forgiven', { debtId: closed.id, closeReason: 'ABSENT_REASSIGN' });
      }
    }
  }

  /**
   * Ca được làm hộ bị dời cho người khác vì người làm hộ khai vắng (S-20): ca đã có người khác làm nên nợ bị hủy (D9).
   * Gọi trong cùng transaction với việc dời ca.
   */
  async cancelForMovedCover(tx: Db, assignmentId: string, now: Date = new Date()): Promise<number> {
    const { count } = await tx.choreDebt.updateMany({
      where: { coverAssignmentId: assignmentId, status: 'OPEN' },
      data: { status: 'CANCELLED', closeReason: 'ABSENT_REASSIGN', settledAt: now },
    });
    return count;
  }

  /**
   * Nợ OPEN quá 4 tuần mà chưa xếp được ca bù thì tha (STALE). Nợ đã có ca bù và nợ đã giao Admin (chọn hỏng 3 lần)
   * không bị tự tha. Idempotent. Trả số nợ vừa đóng.
   */
  async settleStale(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_DAYS * 24 * HOUR);
    const outbox = this.events.outbox();
    const closed = await this.prisma.$transaction(async (tx) => {
      const stale = await tx.choreDebt.findMany({
        where: {
          status: 'OPEN',
          paybackAssignmentId: null,
          pickAttempts: { lt: MAX_PICK_ATTEMPTS },
          createdAt: { lt: cutoff },
          ...(houseIds ? { houseId: { in: houseIds } } : {}),
        },
        select: { id: true, houseId: true },
      });
      for (const d of stale) {
        const { count } = await tx.choreDebt.updateMany({ where: { id: d.id, status: 'OPEN' }, data: { status: 'FORGIVEN', closeReason: 'STALE', settledAt: now } });
        if (count) outbox.toHouse(d.houseId, 'chore_debt:forgiven', { debtId: d.id, closeReason: 'STALE' });
      }
      return stale.length;
    });
    outbox.flush();
    return closed;
  }

  /** Lịch tuần `weekStart` vừa được sinh: mở cửa sổ cho các nợ có ca gốc DONE ở tuần liền trước mà đang chờ lịch. */
  async openWindowsForNewSchedule(tx: Db, outbox: Outbox, houseId: string, weekStart: Date, generatedAt: Date): Promise<number> {
    const prevWeek = dateOf(addDays(dsOf(weekStart), -7));
    const waiting = await tx.choreDebt.findMany({ where: { houseId, status: 'OPEN', pickOpensAt: null } });
    if (!waiting.length) return 0;
    const covers = await tx.choreAssignment.findMany({
      where: { id: { in: waiting.map((d) => d.coverAssignmentId) }, weekStart: prevWeek, status: 'DONE' },
      select: { id: true },
    });
    const ready = new Set(covers.map((c) => c.id));
    let opened = 0;
    for (const debt of waiting) {
      if (!ready.has(debt.coverAssignmentId)) continue;
      await this.openPickWindow(tx, outbox, debt, generatedAt, generatedAt);
      opened++;
    }
    return opened;
  }

  /**
   * Sổ nợ gom theo cặp có hướng (người nợ, người được nợ): "bạn nợ Quân" và "Quân nợ bạn" là hai nhóm, không bù trừ ròng.
   * Gồm nợ OPEN và nợ đã đóng (PAID, FORGIVEN, CANCELLED) có `settledAt` trong 30 ngày gần nhất.
   * `mine` = người xem là debtor hoặc creditor, `all` = cả nhà. Nhóm có khoản nợ cũ nhất đứng trước; tối đa 100 nhóm.
   */
  async list(m: Viewer & { houseId: string }, scope: 'mine' | 'all', now: Date = new Date()): Promise<DebtGroupsResponseDto> {
    const since = new Date(now.getTime() - CLOSED_VISIBLE_DAYS * 24 * HOUR);
    const rows = await this.prisma.choreDebt.findMany({
      where: {
        houseId: m.houseId,
        AND: [
          { OR: [{ status: 'OPEN' }, { settledAt: { gte: since } }] },
          ...(scope === 'mine' ? [{ OR: [{ debtorMemberId: m.id }, { creditorMemberId: m.id }] }] : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!rows.length) return { groups: [], truncated: false };

    // Map giữ thứ tự chèn: lần xuất hiện đầu tiên của cặp là khoản cũ nhất của nhóm, nên nhóm cũ nhất đứng trước.
    const grouped = new Map<string, typeof rows>();
    for (const d of rows) {
      const key = `${d.debtorMemberId}|${d.creditorMemberId}`;
      const list = grouped.get(key);
      if (list) list.push(d);
      else grouped.set(key, [d]);
    }
    const keys = [...grouped.keys()];
    const truncated = keys.length > MAX_DEBT_GROUPS;
    const kept = keys.slice(0, MAX_DEBT_GROUPS).map((k) => grouped.get(k)!);
    const keptRows = kept.flat();

    const [members, slots] = await Promise.all([
      this.prisma.houseMember.findMany({
        where: { id: { in: keptRows.flatMap((d) => [d.debtorMemberId, d.creditorMemberId]) } },
        select: { id: true, user: { select: { fullName: true } } },
      }),
      this.prisma.choreAssignment.findMany({ where: { id: { in: keptRows.map((d) => d.coverAssignmentId) } } }),
    ]);
    const nameOf = new Map(members.map((x) => [x.id, x.user.fullName]));
    const slotOf = new Map(slots.map((s) => [s.id, s]));
    const toDto = (d: (typeof rows)[number]): DebtDto => {
      const cover = slotOf.get(d.coverAssignmentId);
      let phase: DebtPhase = 'WAITING_COVER';
      if (d.paybackAssignmentId) phase = 'PAYBACK_ASSIGNED';
      else if (cover?.status === 'DONE') phase = d.pickOpensAt && d.pickOpensAt.getTime() <= now.getTime() ? 'PICK_WINDOW' : 'WAITING_SCHEDULE';
      return {
        id: d.id,
        debtorMemberId: d.debtorMemberId,
        debtorName: nameOf.get(d.debtorMemberId) ?? '',
        creditorMemberId: d.creditorMemberId,
        creditorName: nameOf.get(d.creditorMemberId) ?? '',
        weight: d.weight,
        status: d.status,
        phase,
        coverAssignment: cover ? { id: cover.id, choreTitle: cover.titleSnapshot, occurrenceDate: dsOf(cover.occurrenceDate), status: cover.status } : null,
        pickOpensAt: d.pickOpensAt,
        pickDeadlineAt: d.pickDeadlineAt,
        pickAttempts: d.pickAttempts,
        paybackAssignmentId: d.paybackAssignmentId,
        createdAt: d.createdAt,
      };
    };

    const groups = kept.map((debts) => {
      // Trong nhóm: OPEN trước, rồi createdAt, rồi id (rows đã sắp createdAt, id; sort ổn định chỉ cần đẩy OPEN lên).
      const ordered = [...debts].sort((x, y) => Number(y.status === 'OPEN') - Number(x.status === 'OPEN'));
      return {
        debtorMemberId: debts[0].debtorMemberId,
        debtorName: nameOf.get(debts[0].debtorMemberId) ?? '',
        creditorMemberId: debts[0].creditorMemberId,
        creditorName: nameOf.get(debts[0].creditorMemberId) ?? '',
        openWeight: debts.filter((d) => d.status === 'OPEN').reduce((n, d) => n + d.weight, 0),
        debts: ordered.map(toDto),
      };
    });
    return { groups, truncated };
  }
}

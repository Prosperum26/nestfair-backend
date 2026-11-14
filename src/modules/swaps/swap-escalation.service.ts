import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { coded } from '../../common/coded-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Db } from '../chores/schedule-context.js';
import { EventsService } from '../events/events.service.js';
import { escalationWindowOk } from './algorithms/swap-rules.js';
import type { EscalateResultDto, EscalateSwapDto } from './dto/escalate-swap.dto.js';
import { closeSwap } from './swap-close.js';
import { fillMessage, SWAP_ERRORS } from './swap-errors.js';
import { contextWindow, evaluateCover, loadSwapContext } from './swap-validator.js';
import { type Actor, SwapsService } from './swaps.service.js';

const HOUR = 3_600_000;
const TX = { timeout: 15_000, maxWait: 15_000 } as const;
/** Tối đa 2 lần ADD_REWARD và 4 yêu cầu trong một chuỗi (spec 5.6, D10). */
const MAX_ADD_REWARD = 2;
const MAX_CHAIN = 4;

const fail = (code: string, extra: Record<string, unknown> = {}) => {
  const spec = SWAP_ERRORS[code];
  return coded(spec.status as HttpStatus, code, fillMessage(spec.message), extra);
};

/** Hết hạn (cron) và leo thang (người gửi chọn khi chưa ai nhận). */
@Injectable()
export class SwapEscalationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly swaps: SwapsService,
  ) {}

  // ------------------------------------------------------------ hết hạn

  /**
   * PENDING quá `expiresAt` → EXPIRED (xóa SwapLock, phát `swap:expired`). COVER còn đến `dueAt − 1h` để chọn
   * leo thang; quá mốc đó mà chưa chọn thì ghi SELF_DEFAULT. Chạy lặp hoặc nhiều instance đều an toàn
   * (`FOR UPDATE SKIP LOCKED`). Trả số yêu cầu vừa chuyển sang EXPIRED.
   */
  async expireDue(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    const due = await this.prisma.choreSwapRequest.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now }, ...(houseIds ? { houseId: { in: houseIds } } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 500,
    });
    let expired = 0;
    for (const { id } of due) {
      const outbox = this.events.outbox();
      const did = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM chore_swap_requests
          WHERE id = ${id}::uuid AND status = 'PENDING' AND "expiresAt" <= ${now.toISOString()}::timestamp
          FOR UPDATE SKIP LOCKED`;
        if (!locked.length) return false;
        const swap = await tx.choreSwapRequest.findUniqueOrThrow({ where: { id } });
        const slot = swap.type === 'COVER' && swap.fromAssignmentId ? await tx.choreAssignment.findUnique({ where: { id: swap.fromAssignmentId }, select: { dueAt: true } }) : null;
        const closed = await closeSwap(tx, swap, 'EXPIRED', 'EXPIRED_NO_TAKER', slot ? { escalationDeadline: new Date(slot.dueAt.getTime() - HOUR) } : {});
        const requester = await tx.houseMember.findUnique({ where: { id: swap.requesterMemberId }, select: { userId: true } });
        if (requester) outbox.toUser(requester.userId, 'swap:expired', { swapId: id, escalationDeadline: closed.escalationDeadline }, { houseId: swap.houseId });
        return true;
      }, TX);
      if (did) {
        expired++;
        outbox.flush();
      }
    }
    // Quá hạn leo thang mà người gửi không chọn gì → tự chịu.
    await this.prisma.choreSwapRequest.updateMany({
      where: { status: 'EXPIRED', escalationChoice: null, escalationDeadline: { lte: now }, ...(houseIds ? { houseId: { in: houseIds } } : {}) },
      data: { escalationChoice: 'SELF_DEFAULT' },
    });
    return expired;
  }

  // ----------------------------------------------------------- leo thang

  async escalate(m: Actor, swapId: string, dto: EscalateSwapDto, idemKey: string, now: Date = new Date()): Promise<EscalateResultDto> {
    const outbox = this.events.outbox();
    const out = await this.prisma.$transaction((tx) => this.escalateInTx(tx, m, swapId, dto, idemKey, now, outbox), TX);
    outbox.flush();
    const [swap, newSwap] = await this.swaps.present(out.newSwap ? [out.swap, out.newSwap] : [out.swap], m);
    return newSwap ? { swap, newSwap } : { swap };
  }

  private async escalateInTx(tx: Db, m: Actor, swapId: string, dto: EscalateSwapDto, idemKey: string, now: Date, outbox: ReturnType<EventsService['outbox']>) {
    await tx.$queryRaw`SELECT id FROM chore_swap_requests WHERE id = ${swapId}::uuid FOR UPDATE`;
    const swap = await tx.choreSwapRequest.findUnique({ where: { id: swapId } });
    if (!swap || swap.houseId !== m.houseId) throw coded(HttpStatus.NOT_FOUND, 'SWAP_NOT_FOUND', 'Không tìm thấy yêu cầu đổi ca.');
    if (swap.requesterMemberId !== m.id) throw fail('NOT_REQUESTER');

    // Gọi lại với cùng key: trả kết quả cũ.
    const prior = await tx.choreSwapRequest.findUnique({ where: { requesterMemberId_createIdemKey: { requesterMemberId: m.id, createIdemKey: idemKey } } });
    if (prior && prior.rootRequestId === swap.rootRequestId && swap.escalationChoice) return { swap, newSwap: prior };
    if (dto.action === 'SELF' && swap.escalationChoice === 'SELF') return { swap };

    if (swap.status !== 'EXPIRED' || swap.escalationChoice !== null || swap.type !== 'COVER' || !swap.fromAssignmentId) throw fail('SWAP_NOT_PENDING');

    if (dto.action === 'SELF') {
      return { swap: await tx.choreSwapRequest.update({ where: { id: swap.id }, data: { escalationChoice: 'SELF' } }) };
    }

    const chain = await tx.choreSwapRequest.findMany({ where: { rootRequestId: swap.rootRequestId }, select: { targetMemberId: true, escalationChoice: true } });
    if (chain.length >= MAX_CHAIN) throw fail('ESCALATE_LIMIT');
    if (dto.action === 'ADD_REWARD' && chain.filter((c) => c.escalationChoice === 'ADD_REWARD').length >= MAX_ADD_REWARD) throw fail('ESCALATE_LIMIT');

    await tx.$queryRaw`SELECT id FROM chore_assignments WHERE id = ${swap.fromAssignmentId}::uuid AND "houseId" = ${m.houseId}::uuid FOR UPDATE`;
    const slot = await tx.choreAssignment.findUnique({ where: { id: swap.fromAssignmentId } });
    if (!slot) throw fail('SLOT_CHANGED');
    if (!escalationWindowOk(now, slot.dueAt)) throw fail('ESCALATE_TOO_LATE');
    const lock = await tx.swapLock.findUnique({ where: { assignmentId: slot.id } });
    if (slot.assigneeId !== m.id || slot.status !== 'TODO' || lock) throw fail('SLOT_CHANGED');

    let rewardAmount = swap.rewardAmount;
    let rewardNote = swap.rewardNote;
    let targetMemberId: string | null = null;
    if (dto.action === 'ADD_REWARD') {
      const amount = dto.rewardAmount ?? null;
      const note = dto.rewardNote?.trim() || null;
      if (amount !== null && (amount < 1000 || amount > 500_000 || amount % 1000 !== 0)) throw fail('REWARD_OUT_OF_RANGE');
      const raised = amount !== null && amount > (swap.rewardAmount ?? 0);
      const newNote = note !== null && note !== swap.rewardNote;
      if (!raised && !newNote) throw fail('REWARD_NOT_INCREASED');
      rewardAmount = amount ?? swap.rewardAmount;
      rewardNote = note ?? swap.rewardNote;
    } else {
      const win = contextWindow([slot]);
      const ctx = await loadSwapContext(tx, m.houseId, win.from, win.to);
      const tried = new Set(chain.map((c) => c.targetMemberId).filter((x): x is string => !!x));
      const candidates = [...ctx.members.values()]
        .filter((c) => !c.leftAt && c.id !== m.id && !tried.has(c.id))
        .filter((c) => evaluateCover(ctx, { requesterMemberId: m.id, from: slot, targetMemberId: c.id, compensation: swap.compensation!, rewardAmount: swap.rewardAmount, now, phase: 'create' }).length === 0)
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const chosen = dto.targetMemberId ? candidates.find((c) => c.id === dto.targetMemberId) : candidates[0];
      if (!chosen) throw fail('NO_RESEND_CANDIDATE');
      targetMemberId = chosen.id;
    }

    const id = randomUUID();
    const locked = await tx.swapLock.createMany({ data: [{ assignmentId: slot.id, swapRequestId: id }], skipDuplicates: true });
    if (locked.count !== 1) throw fail('SLOT_LOCKED');
    const newSwap = await tx.choreSwapRequest.create({
      data: {
        id,
        houseId: m.houseId,
        type: 'COVER',
        requesterMemberId: m.id,
        targetMemberId,
        fromAssignmentId: slot.id,
        // ADD_REWARD luôn là quà (spec 5.6: COVER + GIFT, Chợ ca); RESEND giữ nguyên cách đền đáp của yêu cầu cũ.
        compensation: dto.action === 'ADD_REWARD' ? 'GIFT' : swap.compensation,
        rewardAmount,
        rewardNote,
        reason: swap.reason,
        note: targetMemberId ? swap.note : null,
        expiresAt: new Date(Math.min(now.getTime() + 24 * HOUR, slot.dueAt.getTime() - HOUR)),
        rootRequestId: swap.rootRequestId,
        fromWeightSnapshot: slot.weightSnapshot,
        fromVersion: slot.version,
        createIdemKey: idemKey,
      },
    });
    const updated = await tx.choreSwapRequest.update({ where: { id: swap.id }, data: { escalationChoice: dto.action, resolution: 'ESCALATED' } });

    const payload = { oldSwapId: swap.id, newSwapId: id, action: dto.action };
    if (targetMemberId) {
      const target = await tx.houseMember.findUnique({ where: { id: targetMemberId }, select: { userId: true } });
      if (target) outbox.toUser(target.userId, 'swap:escalated', payload, { houseId: m.houseId });
    } else {
      outbox.toHouse(m.houseId, 'swap:escalated', payload);
    }
    return { swap: updated, newSwap };
  }
}

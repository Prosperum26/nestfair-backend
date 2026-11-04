import { HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { Compensation } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { loadAssignmentForUser } from '../chores/assignment-access.js';
import { dsOf } from '../chores/schedule-context.js';
import type { OptionType, SwapOptionDto, SwapOptionsDto } from './dto/swap-options.dto.js';
import {
  contextWindow,
  coverWarnings,
  evaluateCover,
  evaluateExchange,
  exchangeWarnings,
  loadSwapContext,
  type Violation,
} from './swap-validator.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 100;
const CANDIDATE_STATUSES = ['TODO', 'PENDING_VERIFY', 'REJECTED'] as const;

const verdict = (v: Violation | undefined) =>
  v ? { valid: false, reasonCode: v.code, detailCode: v.reasonCode, reasonText: v.message } : { valid: true };

@Injectable()
export class SwapOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Gợi ý ứng viên cho một ca: danh sách kèm vì sao không chọn được, và có đăng Chợ ca được không. */
  async options(
    userId: string,
    assignmentId: string,
    type: OptionType,
    now: Date = new Date(),
    compensation: Compensation = 'GIFT',
  ): Promise<SwapOptionsDto> {
    const { assignment: row, membership } = await loadAssignmentForUser(this.prisma, userId, assignmentId);
    if (row.assigneeId !== membership.id) {
      throw coded(HttpStatus.FORBIDDEN, 'NOT_SLOT_OWNER', 'Đây không phải ca của bạn.');
    }
    const from = await this.prisma.choreAssignment.findUniqueOrThrow({ where: { id: row.id } });
    const requesterMemberId = membership.id;

    if (type === 'EXCHANGE') {
      const lo = new Date(from.weekStart.getTime() - 7 * DAY_MS);
      const hi = new Date(from.weekStart.getTime() + 7 * DAY_MS);
      const candidates = await this.prisma.choreAssignment.findMany({
        where: {
          houseId: from.houseId,
          assigneeId: { not: requesterMemberId },
          weekStart: { gte: lo, lte: hi },
          status: { in: [...CANDIDATE_STATUSES] },
          source: { not: 'WHEEL' },
        },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: MAX_CANDIDATES,
      });
      const win = contextWindow([from, ...candidates]);
      const ctx = await loadSwapContext(this.prisma, from.houseId, win.from, win.to);
      const options: SwapOptionDto[] = candidates
        .filter((c) => c.assigneeId !== null)
        .map((to) => {
          const input = { requesterMemberId, from, to, now };
          const violations = evaluateExchange(ctx, input);
          return {
            assignmentId: to.id,
            memberId: to.assigneeId!,
            memberName: ctx.members.get(to.assigneeId!)?.name ?? '',
            choreTitle: to.titleSnapshot,
            occurrenceDate: dsOf(to.occurrenceDate),
            dueAt: to.dueAt,
            weight: to.weightSnapshot,
            ...verdict(violations[0]),
            warnings: violations.length === 0 ? exchangeWarnings(ctx, input) : [],
          };
        });
      const market = evaluateCover(ctx, { requesterMemberId, from, targetMemberId: null, compensation, now });
      return { type, options, market: { allowed: market.length === 0, reasonText: market[0]?.message ?? null } };
    }

    const win = contextWindow([from]);
    const ctx = await loadSwapContext(this.prisma, from.houseId, win.from, win.to);
    const options: SwapOptionDto[] = [...ctx.members.values()]
      .filter((m) => !m.leftAt && m.id !== requesterMemberId)
      .map((m) => {
        const input = { requesterMemberId, from, targetMemberId: m.id, compensation, now };
        const violations = evaluateCover(ctx, input);
        return {
          memberId: m.id,
          memberName: m.name,
          ...verdict(violations[0]),
          warnings: violations.length === 0 ? coverWarnings(ctx, input) : [],
        };
      });
    const market = evaluateCover(ctx, { requesterMemberId, from, targetMemberId: null, compensation, now });
    return { type, options, market: { allowed: market.length === 0, reasonText: market[0]?.message ?? null } };
  }
}

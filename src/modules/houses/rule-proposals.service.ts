import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { actorOfUser } from '../events/actor.js';
import { EventsService } from '../events/events.service.js';
import { applyRuleProposal, ruleItems } from './algorithms/rule-proposal.js';
import type { CreateRuleProposalDto, RuleProposalDto } from './dto/rule-proposal.dto.js';
import type { HouseMembership } from './guards/house-member.guard.js';

/** Mỗi người tối đa 3 đề xuất đang chờ (chống spam trưởng phòng). */
export const MAX_PENDING_PER_USER = 3;
const LIST_LIMIT = 50;

const SELECT = {
  id: true,
  kind: true,
  targetText: true,
  content: true,
  reason: true,
  status: true,
  decidedAt: true,
  rejectReason: true,
  createdAt: true,
  proposer: { select: { id: true, fullName: true, avatarUrl: true } },
} satisfies Prisma.RuleProposalSelect;

type Row = Prisma.RuleProposalGetPayload<{ select: typeof SELECT }>;

const toDto = ({ proposer, ...row }: Row): RuleProposalDto => ({
  ...row,
  proposer: { userId: proposer.id, fullName: proposer.fullName, avatarUrl: proposer.avatarUrl },
});

const lockHouse = (tx: Prisma.TransactionClient, houseId: string) =>
  tx.$queryRaw`SELECT id FROM houses WHERE id = ${houseId}::uuid FOR UPDATE`;

@Injectable()
export class RuleProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** Cả nhà xem được mọi đề xuất (minh bạch), mới nhất trước. */
  async list(houseId: string): Promise<RuleProposalDto[]> {
    const rows = await this.prisma.ruleProposal.findMany({
      where: { houseId },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      select: SELECT,
    });
    return rows.map(toDto);
  }

  async create(membership: HouseMembership, dto: CreateRuleProposalDto): Promise<RuleProposalDto> {
    if (membership.role === 'ADMIN') {
      throw coded(HttpStatus.FORBIDDEN, 'ADMIN_EDITS_DIRECTLY', 'Trưởng phòng sửa nội quy trực tiếp ở Cài đặt nhà.');
    }
    const { houseId, userId } = membership;
    const actor = await actorOfUser(this.prisma, userId);
    const outbox = this.events.outbox();

    const row = await this.prisma.$transaction(async (tx) => {
      // Khóa dòng nhà: kiểm tra giới hạn 3 đề xuất không bị vượt khi bấm đúp.
      await lockHouse(tx, houseId);
      const house = await tx.house.findUniqueOrThrow({ where: { id: houseId }, select: { rules: true } });
      const data = this.validate(dto, house.rules);

      const pending = await tx.ruleProposal.count({ where: { houseId, proposerId: userId, status: 'PENDING' } });
      if (pending >= MAX_PENDING_PER_USER) {
        throw coded(
          HttpStatus.CONFLICT,
          'TOO_MANY_PENDING',
          `Bạn đang có ${MAX_PENDING_PER_USER} đề xuất chờ duyệt. Đợi trưởng phòng xử lý hoặc rút bớt nhé.`,
        );
      }
      return tx.ruleProposal.create({
        data: { houseId, proposerId: userId, kind: dto.kind, reason: dto.reason ?? null, ...data },
        select: SELECT,
      });
    });

    outbox.toHouse(houseId, 'rule_proposal:created', { proposalId: row.id }, actor).flush();
    return toDto(row);
  }

  /** Trưởng phòng duyệt: áp vào nội quy ngay, cùng transaction và cùng khóa dòng nhà. */
  async approve(membership: HouseMembership, proposalId: string): Promise<RuleProposalDto> {
    return this.decide(membership, proposalId, async (tx, proposal) => {
      const house = await tx.house.findUniqueOrThrow({ where: { id: membership.houseId }, select: { rules: true } });
      const result = applyRuleProposal(house.rules, proposal);
      if (!result.ok) {
        throw result.reason === 'RULE_CHANGED'
          ? coded(HttpStatus.CONFLICT, 'RULE_CHANGED', 'Điều này đã được sửa hoặc bỏ sau khi đề xuất. Bạn có thể từ chối đề xuất.')
          : coded(HttpStatus.CONFLICT, 'RULES_TOO_LONG', 'Nội quy sẽ vượt 1000 ký tự. Rút gọn nội quy trước khi duyệt.');
      }
      await tx.house.update({ where: { id: membership.houseId }, data: { rules: result.rules } });
      return { status: 'APPROVED' as const };
    });
  }

  async reject(membership: HouseMembership, proposalId: string, reason?: string): Promise<RuleProposalDto> {
    return this.decide(membership, proposalId, () =>
      Promise.resolve({ status: 'REJECTED' as const, rejectReason: reason ?? null }),
    );
  }

  /** Người đề xuất rút lại khi còn chờ. */
  async withdraw(membership: HouseMembership, proposalId: string): Promise<RuleProposalDto> {
    const row = await this.prisma.$transaction(async (tx) => {
      await lockHouse(tx, membership.houseId);
      const proposal = await this.findPending(tx, membership.houseId, proposalId);
      if (proposal.proposerId !== membership.userId) {
        throw coded(HttpStatus.FORBIDDEN, 'NOT_PROPOSER', 'Chỉ người đề xuất mới rút lại được.');
      }
      return tx.ruleProposal.update({ where: { id: proposalId }, data: { status: 'WITHDRAWN' }, select: SELECT });
    });
    this.events.emitToHouse(membership.houseId, 'rule_proposal:decided', { proposalId, status: row.status });
    return toDto(row);
  }

  private async decide(
    membership: HouseMembership,
    proposalId: string,
    apply: (
      tx: Prisma.TransactionClient,
      proposal: { kind: Row['kind']; targetText: string | null; content: string | null },
    ) => Promise<{ status: 'APPROVED' | 'REJECTED'; rejectReason?: string | null }>,
  ): Promise<RuleProposalDto> {
    const actor = await actorOfUser(this.prisma, membership.userId);
    const outbox = this.events.outbox();
    const row = await this.prisma.$transaction(async (tx) => {
      await lockHouse(tx, membership.houseId);
      const proposal = await this.findPending(tx, membership.houseId, proposalId);
      const decision = await apply(tx, proposal);
      return tx.ruleProposal.update({
        where: { id: proposalId },
        data: { ...decision, decidedById: membership.userId, decidedAt: new Date() },
        select: SELECT,
      });
    });
    outbox
      .toHouse(membership.houseId, 'rule_proposal:decided', { proposalId, status: row.status }, actor)
      .flush();
    return toDto(row);
  }

  /** Đề xuất của đúng nhà (không thấy thì 404), còn PENDING (không thì 409). Gọi sau khi đã khóa dòng nhà. */
  private async findPending(tx: Prisma.TransactionClient, houseId: string, proposalId: string) {
    const proposal = await tx.ruleProposal.findFirst({ where: { id: proposalId, houseId } });
    if (!proposal) throw new NotFoundException('Không tìm thấy đề xuất.');
    if (proposal.status !== 'PENDING') {
      throw coded(HttpStatus.CONFLICT, 'ALREADY_DECIDED', 'Đề xuất này đã được xử lý.');
    }
    return proposal;
  }

  /** Ràng buộc theo loại; `targetText` phải là một điều đang có trong nội quy. */
  private validate(dto: CreateRuleProposalDto, rules: string | null) {
    const bad = (message: string) => coded(HttpStatus.BAD_REQUEST, 'INVALID_PROPOSAL', message);
    if (dto.kind === 'ADD') {
      if (!dto.content) throw bad('Nhập nội dung điều muốn thêm.');
      return { targetText: null, content: dto.content };
    }
    if (!dto.targetText) throw bad('Chọn điều nội quy muốn sửa hoặc bỏ.');
    if (!ruleItems(rules).includes(dto.targetText)) throw bad('Điều này không còn trong nội quy. Tải lại trang để xem bản mới.');
    if (dto.kind === 'REMOVE') return { targetText: dto.targetText, content: null };
    if (!dto.content) throw bad('Nhập nội dung mới cho điều này.');
    if (dto.content === dto.targetText) throw bad('Nội dung mới giống hệt điều cũ.');
    return { targetText: dto.targetText, content: dto.content };
  }
}

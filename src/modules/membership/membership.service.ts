import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AdjustmentKind } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { ScheduleService } from '../chores/schedule.service.js';
import { actorOfUser } from '../events/actor.js';
import { type EventActor, EventsService, type Outbox } from '../events/events.service.js';
import { LedgerService } from '../expenses/ledger.service.js';
import type { HouseMembership } from '../houses/guards/house-member.guard.js';
import { SwapLifecycleService } from '../swaps/swap-lifecycle.service.js';
import { planAdjustment } from './algorithms/balance-adjustment.js';
import type {
  KickMemberDto,
  LeaveHouseDto,
  LeavePreviewDto,
  RemoveMemberResultDto,
  ShiftMode,
  TransferAdminDto,
  TransferAdminResultDto,
} from './dto/membership.dto.js';

type Tx = Prisma.TransactionClient;

interface ActiveMember {
  id: string;
  userId: string;
  role: 'ADMIN' | 'ROOMMATE';
  fullName: string;
}

/** Kết quả transaction rời / xóa, để làm phần sau commit (đá socket, chia ca, phát sự kiện). */
interface Removed {
  member: ActiveMember;
  kicked: boolean;
  adjustment: { kind: AdjustmentKind; amount: number; toUserId: string | null } | null;
  shifts: ShiftMode;
  futureShifts: number;
  unassignedIds: string[];
  cancelledSettlements: { id: string; fromUserId: string; toUserId: string }[];
}

const lockHouse = (tx: Tx, houseId: string) => tx.$queryRaw`SELECT id FROM houses WHERE id = ${houseId}::uuid FOR UPDATE`;

const notFound = () => coded(HttpStatus.NOT_FOUND, 'MEMBER_NOT_FOUND', 'Không tìm thấy thành viên này trong nhà.');

/**
 * Rời nhà, trưởng phòng xóa thành viên, chuyển quyền trưởng phòng. Mọi thay đổi chạy trong một transaction
 * có khóa dòng nhà (cùng khóa với vào nhà / sửa nhà), nên không đua với người đang vào hay bấm đúp.
 */
@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly swaps: SwapLifecycleService,
    private readonly schedule: ScheduleService,
    private readonly activity: ActivityService,
    private readonly events: EventsService,
  ) {}

  /** Thông tin để dựng hộp thoại rời / xóa. Trưởng phòng xem của mọi người, thành viên chỉ xem của mình. */
  async preview(m: HouseMembership, userId: string, now: Date = new Date()): Promise<LeavePreviewDto> {
    if (m.role !== 'ADMIN' && m.userId !== userId) {
      throw coded(HttpStatus.FORBIDDEN, 'NOT_ALLOWED', 'Chỉ trưởng phòng mới xem được thông tin này của người khác.');
    }
    const members = await this.activeMembers(this.prisma, m.houseId);
    const member = members.find((x) => x.userId === userId);
    if (!member) throw notFound();

    const [net, pendingSettlements, openChoreDebts, futureShifts] = await Promise.all([
      this.ledger.netBalances(m.houseId),
      this.prisma.settlement.count({ where: { houseId: m.houseId, status: 'PENDING', OR: [{ fromUserId: userId }, { toUserId: userId }] } }),
      this.prisma.choreDebt.count({ where: { houseId: m.houseId, status: 'OPEN', OR: [{ debtorMemberId: member.id }, { creditorMemberId: member.id }] } }),
      this.futureShiftCount(this.prisma, member.id, now),
    ]);
    return {
      userId,
      fullName: member.fullName,
      role: member.role,
      net: net.get(userId) ?? 0,
      pendingSettlements,
      openChoreDebts,
      futureShifts,
      isLastMember: members.length === 1,
    };
  }

  /** Tự rời nhà: chỉ khi số dư bằng 0. Trưởng phòng phải giao quyền cho người khác trong cùng transaction. */
  async leave(m: HouseMembership, dto: LeaveHouseDto, now: Date = new Date()): Promise<RemoveMemberResultDto> {
    const actor = await actorOfUser(this.prisma, m.userId);
    const outbox = this.events.outbox();
    const removed = await this.prisma.$transaction(async (tx) => {
      await lockHouse(tx, m.houseId);
      const members = await this.activeMembers(tx, m.houseId);
      const me = members.find((x) => x.id === m.id);
      if (!me) throw notFound();
      if (members.length === 1) {
        throw coded(HttpStatus.CONFLICT, 'LAST_MEMBER', 'Bạn là người cuối cùng trong nhà nên chưa rời được.');
      }

      if (me.role === 'ADMIN') {
        if (!dto.newAdminUserId) {
          throw coded(HttpStatus.CONFLICT, 'NEW_ADMIN_REQUIRED', 'Chọn người nhận quyền trưởng phòng trước khi rời nhà.');
        }
        const next = members.find((x) => x.userId === dto.newAdminUserId);
        if (!next || next.id === me.id) {
          throw coded(HttpStatus.BAD_REQUEST, 'INVALID_NEW_ADMIN', 'Người nhận quyền phải là một thành viên khác đang ở trong nhà.');
        }
        await this.swapRoles(tx, me, next);
      }

      const net = (await this.ledger.netBalances(m.houseId, tx)).get(me.userId) ?? 0;
      if (net !== 0) {
        throw coded(
          HttpStatus.CONFLICT,
          'HAS_BALANCE',
          net < 0 ? 'Bạn còn khoản cần trả. Thanh toán xong rồi mới rời nhà được.' : 'Bạn còn khoản chưa nhận. Nhận đủ rồi mới rời nhà được.',
          { net },
        );
      }
      return this.remove(tx, outbox, m.houseId, me, { actor, kicked: false, shifts: 'AUTO', now });
    });
    return this.afterRemove(m.houseId, removed, outbox, actor, now);
  }

  /** Trưởng phòng xóa thành viên. Còn số dư thì phải chọn xóa khoản đó hoặc chuyển cho người khác. */
  async kick(m: HouseMembership, userId: string, dto: KickMemberDto, now: Date = new Date()): Promise<RemoveMemberResultDto> {
    if (userId === m.userId) {
      throw coded(HttpStatus.BAD_REQUEST, 'CANNOT_KICK_SELF', 'Bạn không tự xóa mình được. Dùng "Rời nhà" trong Hồ sơ.');
    }
    const actor = await actorOfUser(this.prisma, m.userId);
    const outbox = this.events.outbox();
    const shifts = dto.shifts ?? 'AUTO';

    const removed = await this.prisma.$transaction(async (tx) => {
      await lockHouse(tx, m.houseId);
      const members = await this.activeMembers(tx, m.houseId);
      const target = members.find((x) => x.userId === userId);
      if (!target) throw notFound();
      if (target.role === 'ADMIN') {
        throw coded(HttpStatus.CONFLICT, 'CANNOT_KICK_ADMIN', 'Không xóa được trưởng phòng.');
      }

      // Số dư tính lại trong transaction: client chỉ gửi lựa chọn, không gửi số tiền.
      const balances = await this.ledger.netBalances(m.houseId, tx);
      const net = balances.get(userId) ?? 0;
      let adjustment: Removed['adjustment'] = null;
      if (net !== 0) {
        if (!dto.mode) {
          throw coded(
            HttpStatus.CONFLICT,
            'BALANCE_DECISION_REQUIRED',
            `${target.fullName} còn số dư chưa xử lý. Chọn xóa khoản này hoặc chuyển cho thành viên khác.`,
            { net },
          );
        }
        if (dto.mode === 'TRANSFER') {
          const to = members.find((x) => x.userId === dto.toUserId);
          if (!to || to.userId === userId) {
            throw coded(HttpStatus.BAD_REQUEST, 'INVALID_TRANSFER_TARGET', 'Người nhận phải là một thành viên khác đang ở trong nhà.');
          }
        }
        const lines = planAdjustment(balances, userId, { mode: dto.mode, toUserId: dto.toUserId, order: members.map((x) => x.userId) });
        const toUserId = dto.mode === 'TRANSFER' ? dto.toUserId! : null;
        await tx.balanceAdjustment.create({
          data: {
            houseId: m.houseId,
            userId,
            kind: dto.mode,
            toUserId,
            amount: net,
            createdById: m.userId,
            lines: { create: lines.map((l) => ({ ...l, houseId: m.houseId })) },
          },
        });
        adjustment = { kind: dto.mode, amount: net, toUserId };
      }

      const result = await this.remove(tx, outbox, m.houseId, target, { actor, kicked: true, shifts, now });
      return { ...result, adjustment };
    });
    return this.afterRemove(m.houseId, removed, outbox, actor, now);
  }

  /** Trưởng phòng giao quyền cho thành viên khác (hai vai đổi cho nhau). */
  async transferAdmin(m: HouseMembership, dto: TransferAdminDto): Promise<TransferAdminResultDto> {
    if (dto.userId === m.userId) {
      throw coded(HttpStatus.BAD_REQUEST, 'INVALID_NEW_ADMIN', 'Bạn đang là trưởng phòng rồi.');
    }
    const actor = await actorOfUser(this.prisma, m.userId);
    await this.prisma.$transaction(async (tx) => {
      await lockHouse(tx, m.houseId);
      const members = await this.activeMembers(tx, m.houseId);
      const me = members.find((x) => x.id === m.id);
      const next = members.find((x) => x.userId === dto.userId);
      if (!next) throw notFound();
      if (!me || me.role !== 'ADMIN') {
        throw coded(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Chỉ trưởng phòng mới làm được việc này.');
      }
      await this.swapRoles(tx, me, next);
    });
    this.events.emitToHouse(m.houseId, 'member:role_changed', { adminUserId: dto.userId, previousAdminUserId: m.userId }, actor);
    return { adminUserId: dto.userId };
  }

  // ---- nội bộ ----

  private async activeMembers(db: Tx | PrismaService, houseId: string): Promise<ActiveMember[]> {
    const rows = await db.houseMember.findMany({
      where: { houseId, leftAt: null },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, userId: true, role: true, user: { select: { fullName: true } } },
    });
    return rows.map(({ user, ...r }) => ({ ...r, fullName: user.fullName }));
  }

  private futureShiftCount(db: Tx | PrismaService, memberId: string, now: Date) {
    return db.choreAssignment.count({ where: { assigneeId: memberId, status: 'TODO', dueAt: { gt: now } } });
  }

  private async swapRoles(tx: Tx, from: ActiveMember, to: ActiveMember) {
    await tx.houseMember.update({ where: { id: to.id }, data: { role: 'ADMIN' } });
    await tx.houseMember.update({ where: { id: from.id }, data: { role: 'ROOMMATE' } });
  }

  /**
   * Phần chung của rời và xóa (đặc tả edge case 9): hủy yêu cầu thanh toán và đổi ca đang chờ, đóng nợ ca
   * (chỉ cảnh báo, không chặn), xử lý ca sắp tới, đặt `leftAt` (không xóa vật lý), ghi hoạt động.
   */
  private async remove(
    tx: Tx,
    outbox: Outbox,
    houseId: string,
    member: ActiveMember,
    opts: { actor: EventActor; kicked: boolean; shifts: ShiftMode; now: Date },
  ): Promise<Removed> {
    const { now } = opts;
    const cancelledSettlements = await tx.settlement.findMany({
      where: { houseId, status: 'PENDING', OR: [{ fromUserId: member.userId }, { toUserId: member.userId }] },
      select: { id: true, fromUserId: true, toUserId: true },
    });
    if (cancelledSettlements.length > 0) {
      await tx.settlement.updateMany({ where: { id: { in: cancelledSettlements.map((s) => s.id) } }, data: { status: 'CANCELLED' } });
    }

    await this.swaps.cancelPendingForMember(tx, outbox, member.id, 'MEMBER_LEFT');
    await tx.choreDebt.updateMany({
      where: { houseId, status: 'OPEN', debtorMemberId: member.id },
      data: { status: 'CANCELLED', closeReason: 'DEBTOR_LEFT', settledAt: now },
    });
    await tx.choreDebt.updateMany({
      where: { houseId, status: 'OPEN', creditorMemberId: member.id },
      data: { status: 'CANCELLED', closeReason: 'CREDITOR_LEFT', settledAt: now },
    });

    const future = await tx.choreAssignment.findMany({
      where: { assigneeId: member.id, status: 'TODO', dueAt: { gt: now } },
      select: { id: true },
    });
    // MANUAL: để trống cho trưởng phòng gán; cron S-18 chỉ chia ca TODO nên không đụng tới ca UNASSIGNED.
    if (opts.shifts === 'MANUAL' && future.length > 0) {
      await tx.choreAssignment.updateMany({
        where: { id: { in: future.map((a) => a.id) } },
        data: { assigneeId: null, status: 'UNASSIGNED', version: { increment: 1 } },
      });
    }

    await tx.houseMember.update({ where: { id: member.id }, data: { leftAt: now } });
    await this.activity.record(tx, outbox, {
      houseId,
      type: 'member.left',
      actor: opts.actor,
      params: { userId: member.userId, name: member.fullName, kicked: opts.kicked },
    });
    return {
      member,
      kicked: opts.kicked,
      adjustment: null,
      shifts: opts.shifts,
      futureShifts: future.length,
      unassignedIds: opts.shifts === 'MANUAL' ? future.map((a) => a.id) : [],
      cancelledSettlements,
    };
  }

  /** Sau commit: đá socket khỏi room nhà, phát sự kiện, chia ca mồ côi (AUTO). */
  private async afterRemove(houseId: string, r: Removed, outbox: Outbox, actor: EventActor, now: Date): Promise<RemoveMemberResultDto> {
    await this.events.removeMemberFromHouse(r.member.userId, houseId, r.member.fullName, r.kicked);
    for (const s of r.cancelledSettlements) outbox.toHouse(houseId, 'settlement:cancelled', { settlementId: s.id, fromUserId: s.fromUserId, toUserId: s.toUserId }, actor);
    if (r.unassignedIds.length > 0) outbox.toHouse(houseId, 'chore:reassigned', { assignmentIds: r.unassignedIds }, actor);
    outbox.flush();

    if (r.shifts === 'AUTO' && r.futureShifts > 0) {
      // Không làm hỏng việc rời nhà nếu chia ca lỗi: cron S-18 sẽ chia lại sau tối đa 10 phút.
      await this.schedule.reassignOrphans(houseId, now).catch((e: unknown) => {
        this.logger.warn(`Chia ca mồ côi của nhà ${houseId} thất bại, chờ cron: ${(e as Error).message}`);
      });
    }
    return { userId: r.member.userId, adjustment: r.adjustment, shifts: r.shifts, futureShifts: r.futureShifts };
  }
}

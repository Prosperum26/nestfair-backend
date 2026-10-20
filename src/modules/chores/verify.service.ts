import { HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AssignmentStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { actorOfUser } from '../events/actor.js';
import { EventsService } from '../events/events.service.js';
import { loadAssignmentForUser } from './assignment-access.js';
import { ASSIGNMENT_INCLUDE, toAssignmentDto } from './assignment.mapper.js';
import { AuditService } from './audit.service.js';
import type { AssignmentDto } from './dto/assignment-response.dto.js';
import type { OverrideAssignmentDto, OverrideAction } from './dto/override-assignment.dto.js';
import type { VerifyAssignmentDto } from './dto/verify-assignment.dto.js';

/** Sau bấy nhiêu lần bị từ chối thì ca chuyển sang `disputed` (chỉ Admin quyết). */
export const MAX_REJECTS = 3;

/** Trạng thái xuất phát hợp lệ của từng hành động override. */
const OVERRIDE_FROM: Record<OverrideAction, AssignmentStatus[]> = {
  FORCE_DONE: ['PENDING_VERIFY', 'REJECTED', 'MISSED'],
  FORCE_REJECT: ['PENDING_VERIFY', 'DONE'],
  REASSIGN: ['TODO', 'UNASSIGNED', 'REJECTED', 'MISSED'],
  CANCEL: ['TODO', 'UNASSIGNED', 'REJECTED', 'MISSED', 'PENDING_VERIFY'],
};

@Injectable()
export class VerifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  private fetch(id: string) {
    return this.prisma.choreAssignment.findUniqueOrThrow({ where: { id }, include: ASSIGNMENT_INCLUDE });
  }

  private stateChanged(message = 'Ca này không còn ở trạng thái phù hợp, hãy tải lại.') {
    return coded(HttpStatus.CONFLICT, 'ASSIGNMENT_STATE_CHANGED', message);
  }

  /** Thành viên khác (không phải người làm) duyệt: PENDING_VERIFY → DONE / REJECTED. Một lượt duyệt là đủ. */
  async verify(userId: string, assignmentId: string, dto: VerifyAssignmentDto, now: Date = new Date()): Promise<AssignmentDto> {
    const { assignment, membership } = await loadAssignmentForUser(this.prisma, userId, assignmentId);
    if (assignment.assigneeId === membership.id) {
      throw coded(HttpStatus.FORBIDDEN, 'SELF_VERIFY_FORBIDDEN', 'Bạn không thể tự duyệt ca của mình.');
    }
    if (assignment.status !== 'PENDING_VERIFY') throw this.stateChanged('Ca này không ở trạng thái chờ duyệt.');

    const approved = dto.decision === 'APPROVED';
    const rejectCount = assignment.rejectCount + (approved ? 0 : 1);
    // Điều kiện trạng thái nằm trong WHERE: hai người duyệt cùng lúc thì chỉ một người ghi được.
    const data: Prisma.ChoreAssignmentUncheckedUpdateManyInput = approved
      ? { status: 'DONE', verifiedById: membership.id, verifiedAt: now, verifyMode: 'PEER', rejectReason: null }
      : {
          status: 'REJECTED',
          rejectReason: dto.reason,
          rejectCount,
          disputed: rejectCount >= MAX_REJECTS,
          verifiedById: membership.id,
          verifiedAt: now,
          verifyMode: 'PEER',
        };
    const { count } = await this.prisma.choreAssignment.updateMany({ where: { id: assignment.id, status: 'PENDING_VERIFY' }, data });
    if (count === 0) throw this.stateChanged('Ca này vừa được người khác xử lý.');

    const row = await this.fetch(assignment.id);
    const outbox = this.events.outbox();
    outbox.toHouse(
      row.houseId,
      'chore:verified',
      {
        assignmentId: row.id,
        weekKey: row.weekKey,
        assigneeId: row.assigneeId,
        verifiedById: membership.id,
        status: row.status,
        verifyMode: row.verifyMode,
        disputed: row.disputed,
      },
      await actorOfUser(this.prisma, userId),
    );
    outbox.flush();
    return toAssignmentDto(row);
  }

  /** Người làm khiếu nại khi nghĩ bị từ chối oan → `disputed`, trưởng phòng xem và quyết. */
  async appeal(userId: string, assignmentId: string): Promise<AssignmentDto> {
    const { assignment, membership } = await loadAssignmentForUser(this.prisma, userId, assignmentId);
    if (assignment.assigneeId !== membership.id) throw coded(HttpStatus.FORBIDDEN, 'NOT_ASSIGNEE', 'Đây không phải ca của bạn.');
    if (assignment.status !== 'REJECTED') throw this.stateChanged('Chỉ khiếu nại được ca đang bị yêu cầu làm lại.');
    if (assignment.disputed) return toAssignmentDto(assignment);

    await this.prisma.choreAssignment.updateMany({ where: { id: assignment.id, status: 'REJECTED' }, data: { disputed: true } });
    await this.audit.log(assignment.houseId, membership.id, 'APPEAL', { rejectReason: assignment.rejectReason }, { assignmentId: assignment.id });
    const row = await this.fetch(assignment.id);
    this.events
      .outbox()
      .toHouse(
        row.houseId,
        'chore:verified',
        { assignmentId: row.id, weekKey: row.weekKey, assigneeId: row.assigneeId, status: row.status, disputed: true },
        await actorOfUser(this.prisma, userId),
      )
      .flush();
    return toAssignmentDto(row);
  }

  /** Trưởng phòng can thiệp từng ca (S-56) và ghi nhật ký. Không FORCE_DONE được ca của chính mình. */
  async override(userId: string, assignmentId: string, dto: OverrideAssignmentDto, now: Date = new Date()): Promise<AssignmentDto> {
    const { assignment, membership } = await loadAssignmentForUser(this.prisma, userId, assignmentId);
    if (membership.role !== 'ADMIN') throw coded(HttpStatus.FORBIDDEN, 'ADMIN_ONLY', 'Chỉ trưởng phòng mới làm được việc này.');
    if (dto.action === 'FORCE_DONE' && assignment.assigneeId === membership.id) {
      throw coded(HttpStatus.FORBIDDEN, 'SELF_VERIFY_FORBIDDEN', 'Bạn không thể tự duyệt ca của mình.');
    }
    if (!OVERRIDE_FROM[dto.action].includes(assignment.status)) throw this.stateChanged();

    let data: Prisma.ChoreAssignmentUncheckedUpdateManyInput;
    switch (dto.action) {
      case 'FORCE_DONE':
        data = { status: 'DONE', verifyMode: 'ADMIN_OVERRIDE', verifiedById: membership.id, verifiedAt: now, disputed: false, rejectReason: null };
        break;
      case 'FORCE_REJECT':
        data = {
          status: 'REJECTED',
          rejectReason: dto.reason,
          rejectCount: { increment: 1 },
          disputed: false,
          verifiedById: membership.id,
          verifiedAt: now,
          verifyMode: 'ADMIN_OVERRIDE',
        };
        break;
      case 'REASSIGN': {
        const target = await this.prisma.houseMember.findFirst({ where: { userId: dto.userId, houseId: assignment.houseId, leftAt: null }, select: { id: true } });
        if (!target) throw coded(HttpStatus.BAD_REQUEST, 'NOT_ELIGIBLE_ASSIGNEE', 'Người nhận ca không còn ở trong nhà.');
        data = {
          assigneeId: target.id,
          source: 'REASSIGN',
          status: 'TODO',
          proofImageUrl: null,
          proofHash: null,
          submittedAt: null,
          isLate: false,
          verifiedById: null,
          verifiedAt: null,
          verifyMode: null,
          rejectReason: null,
          disputed: false,
          checkinKey: null,
        };
        break;
      }
      case 'CANCEL':
        data = { status: 'CANCELLED' };
        break;
    }

    const { count } = await this.prisma.choreAssignment.updateMany({ where: { id: assignment.id, status: assignment.status }, data });
    if (count === 0) throw this.stateChanged('Ca này vừa được người khác xử lý.');

    const row = await this.fetch(assignment.id);
    await this.audit.log(
      assignment.houseId,
      membership.id,
      `OVERRIDE_${dto.action}`,
      { from: assignment.status, to: row.status, reason: dto.reason, toUserId: dto.userId ?? null },
      { assignmentId: assignment.id },
    );
    const common = { assignmentId: row.id, weekKey: row.weekKey, assigneeId: row.assigneeId };
    const actor = await actorOfUser(this.prisma, userId);
    const outbox = this.events.outbox();
    if (dto.action === 'REASSIGN') outbox.toHouse(row.houseId, 'chore:reassigned', { ...common, assignmentIds: [row.id] }, actor);
    else if (dto.action === 'CANCEL') outbox.toHouse(row.houseId, 'chore:cancelled', { ...common, assignmentIds: [row.id] }, actor);
    else outbox.toHouse(row.houseId, 'chore:verified', { ...common, status: row.status, verifyMode: row.verifyMode, disputed: row.disputed }, actor);
    outbox.flush();
    return toAssignmentDto(row);
  }
}

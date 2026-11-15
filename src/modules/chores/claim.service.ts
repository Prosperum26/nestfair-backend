import { HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { actorOfUser } from '../events/actor.js';
import { EventsService } from '../events/events.service.js';
import { loadAssignmentForUser } from './assignment-access.js';
import { ASSIGNMENT_INCLUDE, toAssignmentDto } from './assignment.mapper.js';
import { AuditService } from './audit.service.js';
import type { AssignmentDto } from './dto/assignment-response.dto.js';

@Injectable()
export class ClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Thành viên đang ở nhà tự nhận một ca `UNASSIGNED` của việc đột xuất. Điều kiện trạng thái nằm trong WHERE của một câu
   * UPDATE duy nhất nên hai người nhận cùng lúc chỉ một bên ghi được, bên kia nhận 409. R-FAIR không áp dụng (không xoay vòng).
   */
  async claim(userId: string, assignmentId: string): Promise<AssignmentDto> {
    const { assignment, membership } = await loadAssignmentForUser(this.prisma, userId, assignmentId);
    if (assignment.status !== 'UNASSIGNED') throw this.taken();

    const actor = await actorOfUser(this.prisma, userId);
    const outbox = this.events.outbox();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.choreAssignment.updateMany({
        where: { id: assignment.id, status: 'UNASSIGNED' },
        data: { assigneeId: membership.id, originalAssigneeId: membership.id, status: 'TODO', source: 'CLAIM', version: { increment: 1 } },
      });
      if (count === 0) throw this.taken();
      await this.audit.log(assignment.houseId, membership.id, 'ASSIGNMENT_CLAIMED', { choreTitle: assignment.titleSnapshot }, { assignmentId: assignment.id }, tx);
      await this.activity.record(tx, outbox, {
        houseId: assignment.houseId,
        type: 'chore.claimed',
        actor,
        params: { assignmentId: assignment.id, choreTitle: assignment.titleSnapshot },
      });
    });

    const row = await this.prisma.choreAssignment.findUniqueOrThrow({ where: { id: assignment.id }, include: ASSIGNMENT_INCLUDE });
    outbox.toHouse(row.houseId, 'chore:reassigned', { assignmentId: row.id, weekKey: row.weekKey, assigneeId: row.assigneeId, assignmentIds: [row.id] }, actor);
    outbox.flush();
    return toAssignmentDto(row);
  }

  private taken() {
    return coded(HttpStatus.CONFLICT, 'ASSIGNMENT_STATE_CHANGED', 'Việc này đã có người nhận, hãy tải lại.');
  }
}

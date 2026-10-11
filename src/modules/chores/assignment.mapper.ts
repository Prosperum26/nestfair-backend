import type { Prisma } from '../../generated/prisma/client.js';
import type { AssignmentDto } from './dto/assignment-response.dto.js';

export const ASSIGNMENT_INCLUDE = {
  chore: { select: { title: true, weight: true } },
  assignee: {
    select: {
      userId: true,
      user: { select: { fullName: true, avatarUrl: true } },
    },
  },
} satisfies Prisma.ChoreAssignmentInclude;

export type AssignmentRow = Prisma.ChoreAssignmentGetPayload<{
  include: typeof ASSIGNMENT_INCLUDE;
}>;

export function toAssignmentDto(row: AssignmentRow): AssignmentDto {
  return {
    id: row.id,
    choreId: row.choreId,
    choreTitle: row.chore.title,
    weight: row.chore.weight,
    assigneeId: row.assigneeId,
    originalAssigneeId: row.originalAssigneeId,
    assigneeUserId: row.assignee.userId,
    assigneeName: row.assignee.user.fullName,
    assigneeAvatarUrl: row.assignee.user.avatarUrl,
    weekKey: row.weekKey,
    dueAt: row.dueAt,
    status: row.status,
    source: row.source,
    proofImageUrl: row.proofImageUrl,
    submittedAt: row.submittedAt,
    verifiedById: row.verifiedById,
    verifiedAt: row.verifiedAt,
    rejectReason: row.rejectReason,
  };
}

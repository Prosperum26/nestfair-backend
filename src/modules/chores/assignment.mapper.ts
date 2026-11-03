import type { Prisma, WeekSchedule } from '../../generated/prisma/client.js';
import type { AssignmentDto, ScheduleMetaDto } from './dto/assignment-response.dto.js';
import { dsOf } from './schedule-context.js';
import { toDateStr } from './week.js';

export const ASSIGNMENT_INCLUDE = {
  assignee: {
    select: {
      userId: true,
      user: { select: { fullName: true, avatarUrl: true } },
    },
  },
  wheelLog: { select: { id: true, revealAt: true } },
} satisfies Prisma.ChoreAssignmentInclude;

export type AssignmentRow = Prisma.ChoreAssignmentGetPayload<{
  include: typeof ASSIGNMENT_INCLUDE;
}>;

export function toAssignmentDto(row: AssignmentRow): AssignmentDto {
  return {
    id: row.id,
    choreId: row.choreId,
    choreTitle: row.titleSnapshot,
    weight: row.weightSnapshot,
    assigneeId: row.assigneeId,
    originalAssigneeId: row.originalAssigneeId,
    assigneeUserId: row.assignee?.userId ?? null,
    assigneeName: row.assignee?.user.fullName ?? null,
    assigneeAvatarUrl: row.assignee?.user.avatarUrl ?? null,
    weekKey: row.weekKey,
    weekStart: dsOf(row.weekStart),
    occurrenceDate: dsOf(row.occurrenceDate),
    slotIndex: row.slotIndex,
    dueAt: row.dueAt,
    status: row.status,
    source: row.source,
    wheelSpinId: row.wheelLog?.id ?? null,
    proofImageUrl: row.proofImageUrl,
    submittedAt: row.submittedAt,
    isLate: row.isLate,
    rejectCount: row.rejectCount,
    verifiedById: row.verifiedById,
    verifiedAt: row.verifiedAt,
    verifyMode: row.verifyMode,
    rejectReason: row.rejectReason,
    disputed: row.disputed,
  };
}

/** Trạng thái hiệu dụng: lịch đã có ca và tuần đã bắt đầu thì coi là LOCKED. */
export function toScheduleMeta(row: WeekSchedule, now: Date = new Date()): ScheduleMetaDto {
  const weekStart = dsOf(row.weekStart);
  return {
    id: row.id,
    weekKey: row.weekKey,
    weekStart,
    status: row.status !== 'EMPTY' && weekStart <= toDateStr(now) ? 'LOCKED' : row.status,
    relaxed: row.relaxed,
    relaxLevel: row.relaxLevel,
    reasons: row.reasons,
    fenceWeeksApplied: row.fenceWeeksApplied,
    rerollCount: row.rerollCount,
    seed: row.seed,
    generatedBy: row.generatedBy,
    attempts: row.attempts,
  };
}

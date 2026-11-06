import { ApiProperty } from '@nestjs/swagger';
import {
  AssignmentSource,
  AssignmentStatus,
  GeneratedBy,
  ScheduleStatus,
  VerifyMode,
} from '../../../generated/prisma/enums.js';

export class AssignmentDto {
  @ApiProperty({ format: 'uuid', description: 'Assignment id.' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Id of the chore this assignment belongs to.' })
  choreId: string;

  @ApiProperty({ description: 'Chore name at the time the schedule was generated (snapshot, unaffected by later renames).' })
  choreTitle: string;

  @ApiProperty({ minimum: 1, maximum: 5, description: 'Chore weight at generation time (snapshot).' })
  weight: number;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'House-member id of the assignee; null when the assignment is unassigned.' })
  assigneeId: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'House-member id of the person originally scheduled; unchanged by swaps.' })
  originalAssigneeId: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'User id of the assignee.' })
  assigneeUserId: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Display name of the assignee.' })
  assigneeName: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Avatar URL of the assignee.' })
  assigneeAvatarUrl: string | null;

  @ApiProperty({ example: '2026-W41', description: 'ISO week key, format YYYY-Www.' })
  weekKey: string;

  @ApiProperty({ example: '2026-10-05', description: 'Monday of the week (YYYY-MM-DD, house time zone).' })
  weekStart: string;

  @ApiProperty({ example: '2026-10-08', description: 'Day the chore must be done (YYYY-MM-DD, house time zone).' })
  occurrenceDate: string;

  @ApiProperty({ description: 'Position of this assignment among several on the same chore and day (0-based).' })
  slotIndex: number;

  @ApiProperty({ description: 'Deadline (ISO 8601 UTC).' })
  dueAt: Date;

  @ApiProperty({ enum: AssignmentStatus, enumName: 'AssignmentStatus', description: 'TODO, PENDING_VERIFY (photo submitted), DONE, REJECTED (proof refused) or MISSED.' })
  status: AssignmentStatus;

  @ApiProperty({ enum: AssignmentSource, enumName: 'AssignmentSource', description: 'How the assignment came to be (scheduler, wheel spin, cover swap, ...).' })
  source: AssignmentSource;

  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'Id of the Lucky Wheel spin that created this assignment (source = WHEEL).' })
  wheelSpinId: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'URL of the proof photo, or null before check-in.' })
  proofImageUrl: string | null;

  @ApiProperty({ type: Date, nullable: true, description: 'When the proof was submitted (ISO 8601 UTC).' })
  submittedAt: Date | null;

  @ApiProperty({ description: 'true when the proof was submitted after the deadline but within the grace period.' })
  isLate: boolean;

  @ApiProperty({ description: 'How many times the proof has been rejected. Three rejections make the assignment disputed.' })
  rejectCount: number;

  @ApiProperty({ type: String, nullable: true, description: 'House-member id of the verifier; null when it was verified automatically.' })
  verifiedById: string | null;

  @ApiProperty({ type: Date, nullable: true, description: 'When the assignment was verified (ISO 8601 UTC).' })
  verifiedAt: Date | null;

  @ApiProperty({ enum: VerifyMode, enumName: 'VerifyMode', nullable: true, description: 'Who verified it: a housemate (PEER), the admin, or the system.' })
  verifyMode: VerifyMode | null;

  @ApiProperty({ type: String, nullable: true, description: 'Reason given by the verifier on the latest rejection.' })
  rejectReason: string | null;

  @ApiProperty({ description: 'true while the admin must decide (rejected three times, or the assignee appealed).' })
  disputed: boolean;
}

export class ScheduleMetaDto {
  @ApiProperty({ format: 'uuid', description: 'Schedule id.' })
  id: string;

  @ApiProperty({ example: '2026-W41', description: 'ISO week key.' })
  weekKey: string;

  @ApiProperty({ example: '2026-10-05', description: 'Monday of the week.' })
  weekStart: string;

  @ApiProperty({ enum: ScheduleStatus, enumName: 'ScheduleStatus', description: 'PUBLISHED before the week starts, LOCKED once the week has started.' })
  status: ScheduleStatus;

  @ApiProperty({ description: 'true when the fairness fence had to be relaxed to find a valid schedule.' })
  relaxed: boolean;

  @ApiProperty({ description: 'How many steps the fence was relaxed (0 = not relaxed).' })
  relaxLevel: number;

  @ApiProperty({ type: [String], description: 'Reason codes explaining a relaxed or empty schedule, for example FEW_OPTIONS or SMALL_HOUSE.' })
  reasons: string[];

  @ApiProperty({ description: 'Effective fairness window in weeks (3, 2 or 1): nobody repeats the same chore within it.' })
  fenceWeeksApplied: number;

  @ApiProperty({ description: 'How many times the schedule has been re-rolled.' })
  rerollCount: number;

  @ApiProperty({ description: 'Random seed: the same seed and inputs reproduce the same schedule.' })
  seed: number;

  @ApiProperty({ enum: GeneratedBy, enumName: 'GeneratedBy', description: 'Who generated it: the weekly cron job or a member.' })
  generatedBy: GeneratedBy;

  @ApiProperty({ description: 'Number of generation attempts used (up to 200).' })
  attempts: number;
}

export class WeekViewDto {
  @ApiProperty({ type: ScheduleMetaDto, nullable: true, description: 'Metadata of the schedule, or null when the week has no schedule.' })
  schedule: ScheduleMetaDto | null;

  @ApiProperty({ type: [AssignmentDto], description: 'All assignments of the week.' })
  assignments: AssignmentDto[];
}

export class ShuffleResultDto extends WeekViewDto {
  @ApiProperty({ description: 'false when nothing changed (the schedule already existed, or no different arrangement was found).' })
  changed: boolean;

  @ApiProperty({ required: false, description: 'Human-readable note (Vietnamese) explaining why nothing changed.' })
  message?: string;
}

export class PreviewSlotDto {
  @ApiProperty({ format: 'uuid', description: 'Chore id.' })
  choreId: string;

  @ApiProperty({ description: 'Chore name.' })
  choreTitle: string;

  @ApiProperty({ example: '2026-10-08', description: 'Day of the occurrence (YYYY-MM-DD).' })
  occurrenceDate: string;

  @ApiProperty({ type: String, nullable: true, description: 'House-member id of the proposed assignee.' })
  memberId: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'User id of the proposed assignee.' })
  memberUserId: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Display name of the proposed assignee.' })
  memberName: string | null;
}

export class PreviewResultDto {
  @ApiProperty({ description: 'Random seed that produced this preview.' })
  seed: number;

  @ApiProperty({ enum: ['PUBLISHED', 'EMPTY'], description: 'PUBLISHED when a valid schedule was found, EMPTY when there is nothing to schedule.' })
  status: 'PUBLISHED' | 'EMPTY';

  @ApiProperty({ description: 'true when the fairness fence had to be relaxed.' })
  relaxed: boolean;

  @ApiProperty({ description: 'How many steps the fence was relaxed.' })
  relaxLevel: number;

  @ApiProperty({ description: 'Effective fairness window in weeks (3, 2 or 1).' })
  fenceWeeksApplied: number;

  @ApiProperty({ type: [String], description: 'Reason codes for a relaxed or empty result.' })
  reasons: string[];

  @ApiProperty({ type: [PreviewSlotDto], description: 'The proposed assignments. Nothing is saved.' })
  slots: PreviewSlotDto[];
}

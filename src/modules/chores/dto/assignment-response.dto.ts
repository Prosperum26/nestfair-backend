import { ApiProperty } from '@nestjs/swagger';
import {
  AssignmentSource,
  AssignmentStatus,
  GeneratedBy,
  ScheduleStatus,
  VerifyMode,
} from '../../../generated/prisma/enums.js';

export class AssignmentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) choreId: string;
  @ApiProperty({ description: 'Tên việc lúc sinh lịch (snapshot)' }) choreTitle: string;
  @ApiProperty({ minimum: 1, maximum: 5, description: 'Độ nặng lúc sinh lịch (snapshot)' }) weight: number;
  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'HouseMember.id của người được giao; null khi UNASSIGNED' })
  assigneeId: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'HouseMember.id người được giao lúc xếp lịch (không đổi khi đổi ca)' })
  originalAssigneeId: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'User.id của người được giao' })
  assigneeUserId: string | null;
  @ApiProperty({ type: String, nullable: true }) assigneeName: string | null;
  @ApiProperty({ type: String, nullable: true }) assigneeAvatarUrl: string | null;
  @ApiProperty({ example: '2026-W41' }) weekKey: string;
  @ApiProperty({ example: '2026-10-05', description: 'Thứ Hai của tuần (giờ nhà)' }) weekStart: string;
  @ApiProperty({ example: '2026-10-08', description: 'Ngày làm (giờ nhà)' }) occurrenceDate: string;
  @ApiProperty() slotIndex: number;
  @ApiProperty() dueAt: Date;
  @ApiProperty({ enum: AssignmentStatus, enumName: 'AssignmentStatus' }) status: AssignmentStatus;
  @ApiProperty({ enum: AssignmentSource, enumName: 'AssignmentSource' }) source: AssignmentSource;
  @ApiProperty({ type: String, nullable: true }) proofImageUrl: string | null;
  @ApiProperty({ type: Date, nullable: true }) submittedAt: Date | null;
  @ApiProperty({ description: 'Nộp trong khoảng ân hạn sau hạn' }) isLate: boolean;
  @ApiProperty({ description: 'Số lần đã bị từ chối' }) rejectCount: number;
  @ApiProperty({ type: String, nullable: true, description: 'HouseMember.id của người duyệt; null nếu tự duyệt' })
  verifiedById: string | null;
  @ApiProperty({ type: Date, nullable: true }) verifiedAt: Date | null;
  @ApiProperty({ enum: VerifyMode, enumName: 'VerifyMode', nullable: true }) verifyMode: VerifyMode | null;
  @ApiProperty({ type: String, nullable: true }) rejectReason: string | null;
  @ApiProperty({ description: 'Chờ trưởng phòng quyết (từ chối 3 lần hoặc khiếu nại)' }) disputed: boolean;
}

export class ScheduleMetaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: '2026-W41' }) weekKey: string;
  @ApiProperty({ example: '2026-10-05' }) weekStart: string;
  @ApiProperty({ enum: ScheduleStatus, enumName: 'ScheduleStatus', description: 'LOCKED khi tuần đã bắt đầu' }) status: ScheduleStatus;
  @ApiProperty({ description: 'true nếu phải nới rào để xếp được lịch' }) relaxed: boolean;
  @ApiProperty() relaxLevel: number;
  @ApiProperty({ type: [String], description: 'Mã lý do, ví dụ FEW_OPTIONS, SMALL_HOUSE' }) reasons: string[];
  @ApiProperty({ description: 'Cửa sổ rào hiệu dụng W_eff (3/2/1)' }) fenceWeeksApplied: number;
  @ApiProperty() rerollCount: number;
  @ApiProperty({ description: 'Seed RNG: cùng seed + đầu vào cho cùng lịch' }) seed: number;
  @ApiProperty({ enum: GeneratedBy, enumName: 'GeneratedBy' }) generatedBy: GeneratedBy;
  @ApiProperty() attempts: number;
}

export class WeekViewDto {
  @ApiProperty({ type: ScheduleMetaDto, nullable: true }) schedule: ScheduleMetaDto | null;
  @ApiProperty({ type: [AssignmentDto] }) assignments: AssignmentDto[];
}

export class ShuffleResultDto extends WeekViewDto {
  @ApiProperty({ description: 'false nếu không có gì đổi (đã có lịch, hoặc không có phương án khác)' }) changed: boolean;
  @ApiProperty({ required: false }) message?: string;
}

export class PreviewSlotDto {
  @ApiProperty({ format: 'uuid' }) choreId: string;
  @ApiProperty() choreTitle: string;
  @ApiProperty({ example: '2026-10-08' }) occurrenceDate: string;
  @ApiProperty({ type: String, nullable: true, description: 'HouseMember.id' }) memberId: string | null;
}

export class PreviewResultDto {
  @ApiProperty() seed: number;
  @ApiProperty({ enum: ['PUBLISHED', 'EMPTY'] }) status: 'PUBLISHED' | 'EMPTY';
  @ApiProperty() relaxed: boolean;
  @ApiProperty() relaxLevel: number;
  @ApiProperty() fenceWeeksApplied: number;
  @ApiProperty({ type: [String] }) reasons: string[];
  @ApiProperty({ type: [PreviewSlotDto] }) slots: PreviewSlotDto[];
}

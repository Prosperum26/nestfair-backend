import { ApiProperty } from '@nestjs/swagger';
import {
  AssignmentSource,
  AssignmentStatus,
} from '../../../generated/prisma/enums.js';

export class AssignmentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) choreId: string;
  @ApiProperty() choreTitle: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) weight: number;
  @ApiProperty({ format: 'uuid', description: 'HouseMember.id của người được giao' })
  assigneeId: string;
  @ApiProperty({ format: 'uuid', description: 'User.id của người được giao (khớp với danh sách thành viên)' })
  assigneeUserId: string;
  @ApiProperty() assigneeName: string;
  @ApiProperty({ type: String, nullable: true }) assigneeAvatarUrl: string | null;
  @ApiProperty({ example: '2026-W41' }) weekKey: string;
  @ApiProperty() dueAt: Date;
  @ApiProperty({ enum: AssignmentStatus, enumName: 'AssignmentStatus' })
  status: AssignmentStatus;
  @ApiProperty({ enum: AssignmentSource, enumName: 'AssignmentSource' })
  source: AssignmentSource;
  @ApiProperty({ type: String, nullable: true }) proofImageUrl: string | null;
  @ApiProperty({ type: Date, nullable: true }) submittedAt: Date | null;
  @ApiProperty({ type: String, nullable: true, description: 'HouseMember.id của người duyệt' })
  verifiedById: string | null;
  @ApiProperty({ type: Date, nullable: true }) verifiedAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) rejectReason: string | null;
}

export class ShuffleResultDto {
  @ApiProperty({ type: [AssignmentDto] }) assignments: AssignmentDto[];
  @ApiProperty({ description: 'true nếu phải nới rào 3 tuần để xếp được lịch' })
  relaxed: boolean;
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { CloudinaryService } from '../uploads/cloudinary.service.js';
import {
  type UploadedImage,
  validateImageFile,
} from '../uploads/image-validation.js';
import { loadAssignmentForUser } from './assignment-access.js';
import { ASSIGNMENT_INCLUDE, toAssignmentDto } from './assignment.mapper.js';
import { ChoreScheduleService } from './chore-schedule.service.js';
import type {
  AssignmentDto,
  ShuffleResultDto,
} from './dto/assignment-response.dto.js';
import type { VerifyAssignmentDto } from './dto/verify-assignment.dto.js';
import { isValidWeekKey, weekKeyOf } from './week.js';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly schedule: ChoreScheduleService,
    private readonly events: EventsService,
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async list(houseId: string, weekKey?: string): Promise<AssignmentDto[]> {
    const key = this.resolveWeek(weekKey);
    const rows = await this.schedule.fetchWeek(houseId, key);
    return rows.map(toAssignmentDto);
  }

  async shuffle(houseId: string, weekKey?: string): Promise<ShuffleResultDto> {
    const key = this.resolveWeek(weekKey);
    if (key < weekKeyOf(new Date())) {
      throw new BadRequestException('Không thể xếp lại lịch của tuần đã qua.');
    }
    const { assignments, relaxed } = await this.schedule.generateWeek(
      houseId,
      key,
      'SHUFFLE',
    );
    this.events.emitToHouse(houseId, 'chore:shuffled', {
      weekKey: key,
      relaxed,
    });
    return { assignments, relaxed };
  }

  /** Người được giao nộp ảnh minh chứng: TODO / REJECTED → PENDING_VERIFY. */
  async checkin(
    userId: string,
    assignmentId: string,
    file: UploadedImage | undefined,
  ): Promise<AssignmentDto> {
    const { assignment, membership } = await loadAssignmentForUser(
      this.prisma,
      userId,
      assignmentId,
    );
    if (assignment.assigneeId !== membership.id) {
      throw new ForbiddenException('Đây không phải ca của bạn.');
    }
    validateImageFile(file);
    if (assignment.status !== 'TODO' && assignment.status !== 'REJECTED') {
      throw new ConflictException('Ca này không còn ở trạng thái chờ làm.');
    }
    if (assignment.dueAt.getTime() < Date.now()) {
      throw new ConflictException('Ca này đã quá hạn.');
    }

    const { url } = await this.cloudinary.upload(file.buffer, 'chores');

    // updateMany có điều kiện trạng thái: bấm đúp thì request thứ hai ghi 0 dòng → 409.
    const { count } = await this.prisma.choreAssignment.updateMany({
      where: { id: assignment.id, status: { in: ['TODO', 'REJECTED'] } },
      data: {
        status: 'PENDING_VERIFY',
        proofImageUrl: url,
        submittedAt: new Date(),
        rejectReason: null,
        verifiedById: null,
        verifiedAt: null,
      },
    });
    if (count === 0) throw new ConflictException('Ca này vừa được nộp rồi.');

    const row = await this.prisma.choreAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
      include: ASSIGNMENT_INCLUDE,
    });
    this.events.emitToHouse(row.houseId, 'chore:submitted', {
      assignmentId: row.id,
      weekKey: row.weekKey,
      assigneeId: row.assigneeId,
    });
    return toAssignmentDto(row);
  }

  /** Thành viên khác (không phải người làm) duyệt: PENDING_VERIFY → DONE / REJECTED. */
  async verify(
    userId: string,
    assignmentId: string,
    dto: VerifyAssignmentDto,
  ): Promise<AssignmentDto> {
    const { assignment, membership } = await loadAssignmentForUser(
      this.prisma,
      userId,
      assignmentId,
    );
    if (assignment.assigneeId === membership.id) {
      throw new ForbiddenException('Bạn không thể tự duyệt ca của mình.');
    }
    if (assignment.status !== 'PENDING_VERIFY') {
      throw new ConflictException('Ca này không ở trạng thái chờ duyệt.');
    }

    const approved = dto.decision === 'APPROVE';
    // Điều kiện trạng thái trong WHERE: hai người duyệt cùng lúc thì chỉ một người ghi được.
    const { count } = await this.prisma.choreAssignment.updateMany({
      where: { id: assignment.id, status: 'PENDING_VERIFY' },
      data: {
        status: approved ? 'DONE' : 'REJECTED',
        verifiedById: membership.id,
        verifiedAt: new Date(),
        rejectReason: approved ? null : (dto.reason ?? null),
      },
    });
    if (count === 0) throw new ConflictException('Ca này vừa được duyệt rồi.');

    const row = await this.prisma.choreAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
      include: ASSIGNMENT_INCLUDE,
    });
    this.events.emitToHouse(row.houseId, 'chore:verified', {
      assignmentId: row.id,
      weekKey: row.weekKey,
      assigneeId: row.assigneeId,
      verifiedById: membership.id,
      status: row.status,
    });
    return toAssignmentDto(row);
  }

  private resolveWeek(weekKey?: string): string {
    if (weekKey === undefined) return weekKeyOf(new Date());
    if (!isValidWeekKey(weekKey)) {
      throw new BadRequestException(
        'Tuần không hợp lệ, định dạng đúng là 2026-W41.',
      );
    }
    return weekKey;
  }
}

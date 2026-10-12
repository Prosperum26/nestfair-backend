import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { CloudinaryService } from '../uploads/cloudinary.service.js';
import { sha256, type UploadedImage, validateImageFile } from '../uploads/image-validation.js';
import { loadAssignmentForUser } from './assignment-access.js';
import { ASSIGNMENT_INCLUDE, toAssignmentDto } from './assignment.mapper.js';
import type { AssignmentDto } from './dto/assignment-response.dto.js';
import { openAtOf } from './week.js';
import { dsOf } from './schedule-context.js';

const HOUR = 3_600_000;
/** Ảnh trùng ảnh đã nộp trong nhà trong khoảng này thì bị từ chối (S-53). */
const DUPLICATE_WINDOW_DAYS = 30;

@Injectable()
export class CheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly events: EventsService,
  ) {}

  /**
   * Người được giao nộp ảnh minh chứng: TODO / REJECTED → PENDING_VERIFY (hoặc DONE `SELF_ATTESTED` khi nhà
   * không còn ai khác để duyệt). Thứ tự an toàn: kiểm tra → upload → cập nhật DB bằng compare-and-set;
   * DB thua cuộc hoặc lỗi thì xóa ảnh vừa upload (không để ảnh mồ côi).
   */
  async checkin(
    userId: string,
    assignmentId: string,
    file: UploadedImage | undefined,
    idempotencyKey: string | undefined,
    now: Date = new Date(),
  ): Promise<AssignmentDto> {
    const { assignment, membership } = await loadAssignmentForUser(this.prisma, userId, assignmentId);
    if (assignment.assigneeId !== membership.id) {
      throw coded(HttpStatus.FORBIDDEN, 'NOT_ASSIGNEE', 'Đây không phải ca của bạn.');
    }
    // Retry mạng / bấm đúp với cùng Idempotency-Key: trả lại kết quả, không nộp lần hai.
    if (idempotencyKey && assignment.checkinKey === idempotencyKey && ['PENDING_VERIFY', 'DONE'].includes(assignment.status)) {
      return toAssignmentDto(assignment);
    }

    validateImageFile(file);
    if (assignment.disputed) {
      throw coded(HttpStatus.CONFLICT, 'ASSIGNMENT_DISPUTED', 'Ca này đang chờ trưởng phòng quyết định, chưa thể nộp lại.');
    }
    if (assignment.status !== 'TODO' && assignment.status !== 'REJECTED') {
      throw coded(HttpStatus.CONFLICT, 'ASSIGNMENT_STATE_CHANGED', 'Ca này không còn ở trạng thái chờ làm.');
    }

    const house = await this.prisma.house.findUniqueOrThrow({ where: { id: assignment.houseId }, select: { choreGraceHours: true } });
    if (now < openAtOf(dsOf(assignment.occurrenceDate))) {
      throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'CHECKIN_NOT_OPEN', 'Chưa tới ngày làm nên chưa nộp ảnh được.');
    }
    if (now.getTime() > assignment.dueAt.getTime() + house.choreGraceHours * HOUR) {
      throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'CHECKIN_WINDOW_CLOSED', 'Đã quá hạn nộp ảnh cho ca này.');
    }

    const proofHash = sha256(file.buffer);
    const duplicate = await this.prisma.choreAssignment.findFirst({
      where: { houseId: assignment.houseId, proofHash, submittedAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 24 * HOUR) } },
      select: { id: true },
    });
    if (duplicate) throw coded(HttpStatus.CONFLICT, 'PROOF_DUPLICATE', 'Ảnh này đã được dùng làm minh chứng trước đó, hãy chụp ảnh mới.');

    const uploaded = await this.cloudinary.upload(file.buffer, `houses/${assignment.houseId}/proofs`);
    try {
      const others = await this.prisma.houseMember.count({ where: { houseId: assignment.houseId, leftAt: null, id: { not: membership.id } } });
      const selfAttested = others === 0;
      const { count } = await this.prisma.choreAssignment.updateMany({
        where: { id: assignment.id, status: { in: ['TODO', 'REJECTED'] }, disputed: false },
        data: {
          status: selfAttested ? 'DONE' : 'PENDING_VERIFY',
          proofImageUrl: uploaded.url,
          proofHash,
          submittedAt: now,
          isLate: now.getTime() > assignment.dueAt.getTime(),
          rejectReason: null,
          verifiedById: null,
          verifiedAt: selfAttested ? now : null,
          verifyMode: selfAttested ? 'SELF_ATTESTED' : null,
          checkinKey: idempotencyKey ?? null,
        },
      });
      if (count === 0) {
        await this.cloudinary.destroy(uploaded.publicId);
        const fresh = await this.prisma.choreAssignment.findUniqueOrThrow({ where: { id: assignment.id }, include: ASSIGNMENT_INCLUDE });
        if (idempotencyKey && fresh.checkinKey === idempotencyKey && ['PENDING_VERIFY', 'DONE'].includes(fresh.status)) {
          return toAssignmentDto(fresh);
        }
        throw coded(HttpStatus.CONFLICT, 'ASSIGNMENT_STATE_CHANGED', 'Ca này vừa được nộp rồi.');
      }
    } catch (e) {
      if (!(e instanceof HttpException)) await this.cloudinary.destroy(uploaded.publicId);
      throw e;
    }

    const row = await this.prisma.choreAssignment.findUniqueOrThrow({ where: { id: assignment.id }, include: ASSIGNMENT_INCLUDE });
    this.events.emitToHouse(row.houseId, 'chore:submitted', {
      assignmentId: row.id,
      weekKey: row.weekKey,
      assigneeId: row.assigneeId,
      status: row.status,
      verifyMode: row.verifyMode,
    });
    return toAssignmentDto(row);
  }
}

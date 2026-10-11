import { ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { HouseRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from './audit.service.js';
import { assertDateRange } from './date-range.js';
import type { AbsenceDto, CreateAbsenceDto } from './dto/absence.dto.js';
import { dateOf, dsOf } from './schedule-context.js';
import { ScheduleService } from './schedule.service.js';

interface Actor {
  id: string;
  userId: string;
  role: HouseRole;
}

@Injectable()
export class AbsencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
    private readonly audit: AuditService,
  ) {}

  private toDto(r: { id: string; userId: string; startDate: Date; endDate: Date; reason: string | null; createdById: string; createdAt: Date; user: { fullName: string } }): AbsenceDto {
    return {
      id: r.id,
      userId: r.userId,
      userName: r.user.fullName,
      startDate: dsOf(r.startDate),
      endDate: dsOf(r.endDate),
      reason: r.reason,
      createdById: r.createdById,
      createdAt: r.createdAt,
    };
  }

  async list(houseId: string): Promise<AbsenceDto[]> {
    const rows = await this.prisma.memberAbsence.findMany({
      where: { houseId },
      include: { user: { select: { fullName: true } } },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  /** Khai vắng (S-20/S-21): lịch đã công bố thì dời ngay các ca còn ≥ 24h trong khoảng vắng. */
  async create(houseId: string, actor: Actor, dto: CreateAbsenceDto, now: Date = new Date()): Promise<AbsenceDto> {
    const targetUserId = dto.userId ?? actor.userId;
    if (targetUserId !== actor.userId && actor.role !== 'ADMIN') {
      throw coded(HttpStatus.FORBIDDEN, 'ADMIN_ONLY', 'Chỉ trưởng phòng mới khai vắng hộ người khác.');
    }
    assertDateRange(dto.startDate, dto.endDate);
    const member = await this.prisma.houseMember.findFirst({ where: { houseId, userId: targetUserId, leftAt: null }, select: { id: true } });
    if (!member) throw coded(HttpStatus.BAD_REQUEST, 'NOT_ELIGIBLE_MEMBER', 'Người này không ở trong nhà.');

    const row = await this.prisma.memberAbsence.create({
      data: {
        houseId,
        userId: targetUserId,
        startDate: dateOf(dto.startDate),
        endDate: dateOf(dto.endDate),
        reason: dto.reason,
        createdById: actor.userId,
      },
      include: { user: { select: { fullName: true } } },
    });
    const moved = await this.schedule.moveSlotsForAbsence(houseId, targetUserId, dto.startDate, dto.endDate, now);
    await this.audit.log(houseId, actor.id, 'ABSENCE_CREATED', {
      absenceId: row.id,
      userId: targetUserId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      reason: dto.reason ?? null,
      moved: moved.moved,
      unassigned: moved.unassigned,
    });
    return this.toDto(row);
  }

  /** Xóa khai vắng: chính chủ, người khai hoặc Admin. Không khôi phục các ca đã được dời. */
  async remove(houseId: string, actor: Actor, absenceId: string): Promise<void> {
    const row = await this.prisma.memberAbsence.findFirst({ where: { id: absenceId, houseId } });
    if (!row) throw new NotFoundException('Không tìm thấy khai vắng này.');
    if (actor.role !== 'ADMIN' && row.userId !== actor.userId && row.createdById !== actor.userId) {
      throw new ForbiddenException('Bạn không xóa được khai vắng của người khác.');
    }
    await this.prisma.memberAbsence.delete({ where: { id: row.id } });
    await this.audit.log(houseId, actor.id, 'ABSENCE_DELETED', { absenceId: row.id, userId: row.userId, startDate: dsOf(row.startDate), endDate: dsOf(row.endDate) });
  }
}

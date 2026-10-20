import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { actorOfMember } from '../events/actor.js';
import { EventsService } from '../events/events.service.js';
import { AuditService } from './audit.service.js';
import { assertDateRange } from './date-range.js';
import type { BreakDto, CreateBreakDto } from './dto/absence.dto.js';
import { dateOf, dsOf } from './schedule-context.js';

const toDto = (r: { id: string; startDate: Date; endDate: Date; reason: string | null; createdAt: Date }): BreakDto => ({
  id: r.id,
  startDate: dsOf(r.startDate),
  endDate: dsOf(r.endDate),
  reason: r.reason,
  createdAt: r.createdAt,
});

@Injectable()
export class BreaksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  async list(houseId: string): Promise<BreakDto[]> {
    const rows = await this.prisma.houseBreak.findMany({ where: { houseId }, orderBy: { startDate: 'desc' } });
    return rows.map(toDto);
  }

  /**
   * Cả nhà vắng (Tết, du lịch…): không sinh ca trong khoảng này; ca TODO / chưa có người đã có sẵn thì CANCELLED
   * (không phải MISSED, nên không ai bị tính là bỏ ca).
   */
  async create(houseId: string, actorMemberId: string, actorUserId: string, dto: CreateBreakDto): Promise<BreakDto> {
    assertDateRange(dto.startDate, dto.endDate);
    const row = await this.prisma.houseBreak.create({
      data: { houseId, startDate: dateOf(dto.startDate), endDate: dateOf(dto.endDate), reason: dto.reason, createdById: actorUserId },
    });
    const where = {
      houseId,
      status: { in: ['TODO', 'UNASSIGNED'] as ('TODO' | 'UNASSIGNED')[] },
      occurrenceDate: { gte: dateOf(dto.startDate), lte: dateOf(dto.endDate) },
    };
    const ids = (await this.prisma.choreAssignment.findMany({ where, select: { id: true } })).map((r) => r.id);
    const outbox = this.events.outbox();
    if (ids.length > 0) {
      await this.prisma.choreAssignment.updateMany({ where: { ...where, id: { in: ids } }, data: { status: 'CANCELLED' } });
      outbox.toHouse(houseId, 'chore:cancelled', { breakId: row.id, assignmentIds: ids }, await actorOfMember(this.prisma, actorMemberId));
    }
    await this.audit.log(houseId, actorMemberId, 'BREAK_CREATED', {
      breakId: row.id,
      startDate: dto.startDate,
      endDate: dto.endDate,
      reason: dto.reason ?? null,
      cancelled: ids.length,
    });
    outbox.flush();
    return toDto(row);
  }

  /** Xóa khoảng nghỉ: các lần sinh lịch sau sẽ tính lại; ca đã bị hủy không tự khôi phục. */
  async remove(houseId: string, actorMemberId: string, breakId: string): Promise<void> {
    const row = await this.prisma.houseBreak.findFirst({ where: { id: breakId, houseId } });
    if (!row) throw new NotFoundException('Không tìm thấy khoảng nghỉ này.');
    await this.prisma.houseBreak.delete({ where: { id: row.id } });
    await this.audit.log(houseId, actorMemberId, 'BREAK_DELETED', { breakId: row.id, startDate: dsOf(row.startDate), endDate: dsOf(row.endDate) });
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import type { Chore } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { actorOfMember } from '../events/actor.js';
import { EventsService } from '../events/events.service.js';
import { AuditService } from './audit.service.js';
import { normalizeChore } from './chore-rules.js';
import type { ChoreDto } from './dto/chore-response.dto.js';
import type { CreateChoreDto } from './dto/create-chore.dto.js';
import type { UpdateChoreDto } from './dto/update-chore.dto.js';

const toDto = (c: Chore): ChoreDto => ({
  id: c.id,
  title: c.title,
  weight: c.weight,
  frequency: c.frequency,
  recurrenceDays: c.recurrenceDays,
  dueTime: c.dueTime,
  rotationMode: c.rotationMode,
  occurrenceGap: c.occurrenceGap,
  isActive: c.isActive,
});

const TRACKED = ['title', 'weight', 'frequency', 'recurrenceDays', 'dueTime', 'rotationMode', 'occurrenceGap'] as const;

@Injectable()
export class ChoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  async list(houseId: string, includeInactive = false): Promise<ChoreDto[]> {
    const rows = await this.prisma.chore.findMany({
      where: { houseId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(houseId: string, actorMemberId: string, dto: CreateChoreDto): Promise<ChoreDto> {
    const shape = normalizeChore(dto);
    const row = await this.prisma.chore.create({ data: { houseId, title: dto.title, weight: dto.weight, ...shape } });
    await this.audit.log(houseId, actorMemberId, 'CHORE_CREATED', { choreId: row.id, title: row.title });
    return toDto(row);
  }

  async update(
    houseId: string,
    actorMemberId: string,
    choreId: string,
    dto: UpdateChoreDto,
    now: Date = new Date(),
  ): Promise<ChoreDto> {
    const row = await this.prisma.chore.findFirst({ where: { id: choreId, houseId } });
    if (!row) throw new NotFoundException('Không tìm thấy việc này.');

    const shape = normalizeChore({
      frequency: dto.frequency ?? row.frequency,
      recurrenceDays: dto.recurrenceDays ?? row.recurrenceDays,
      dueTime: dto.dueTime ?? row.dueTime,
      rotationMode: dto.rotationMode ?? row.rotationMode,
      occurrenceGap: dto.occurrenceGap ?? row.occurrenceGap,
    });
    const updated = await this.prisma.chore.update({
      where: { id: choreId },
      data: { title: dto.title ?? row.title, weight: dto.weight ?? row.weight, isActive: dto.isActive ?? row.isActive, ...shape },
    });

    const changed = Object.fromEntries(
      TRACKED.filter((k) => JSON.stringify(row[k]) !== JSON.stringify(updated[k])).map((k) => [k, { from: row[k], to: updated[k] }]),
    );
    if (Object.keys(changed).length > 0) await this.audit.log(houseId, actorMemberId, 'CHORE_UPDATED', { choreId, changed });

    if (row.isActive && !updated.isActive) {
      const cancelled = await this.cancelFutureSlots(houseId, actorMemberId, choreId, now);
      await this.audit.log(houseId, actorMemberId, 'CHORE_DEACTIVATED', { choreId, cancelled: cancelled.length });
    } else if (!row.isActive && updated.isActive) {
      await this.audit.log(houseId, actorMemberId, 'CHORE_ACTIVATED', { choreId });
    }
    return toDto(updated);
  }

  /** S-28: tắt việc thì ca TODO / chưa có người ở tương lai thành CANCELLED (lịch sử giữ nguyên). */
  private async cancelFutureSlots(houseId: string, actorMemberId: string, choreId: string, now: Date): Promise<string[]> {
    const where = {
      houseId,
      choreId,
      status: { in: ['TODO', 'UNASSIGNED'] as ('TODO' | 'UNASSIGNED')[] },
      dueAt: { gt: now },
    };
    const ids = (await this.prisma.choreAssignment.findMany({ where, select: { id: true } })).map((r) => r.id);
    if (ids.length === 0) return [];
    await this.prisma.choreAssignment.updateMany({ where: { ...where, id: { in: ids } }, data: { status: 'CANCELLED' } });
    this.events
      .outbox()
      .toHouse(houseId, 'chore:cancelled', { choreId, assignmentIds: ids }, await actorOfMember(this.prisma, actorMemberId))
      .flush();
    return ids;
  }
}

import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { Chore } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ChoreDebtService } from '../swaps/chore-debt.service.js';
import { ActivityService } from '../activity/activity.service.js';
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
    private readonly activity: ActivityService,
    private readonly debts: ChoreDebtService,
  ) {}

  async list(houseId: string, includeInactive = false): Promise<ChoreDto[]> {
    const rows = await this.prisma.chore.findMany({
      // Việc hệ thống ("Việc đột xuất" của vòng quay) không hiện ở danh sách / màn cài đặt.
      where: { houseId, isSystem: false, ...(includeInactive ? {} : { isActive: true }) },
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
    if (row.isSystem) throw coded(HttpStatus.FORBIDDEN, 'SYSTEM_CHORE', 'Đây là việc hệ thống của vòng quay, không sửa hay tắt được.');

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
      await this.deactivate(houseId, actorMemberId, updated, now);
    } else if (!row.isActive && updated.isActive) {
      await this.audit.log(houseId, actorMemberId, 'CHORE_ACTIVATED', { choreId });
    }
    return toDto(updated);
  }

  /**
   * S-28: tắt việc thì ca TODO / chưa có người ở tương lai thành CANCELLED (lịch sử giữ nguyên).
   * Hủy ca, nhật ký và Live Ticker (một mục cho cả việc) ghi cùng một transaction.
   */
  private async deactivate(houseId: string, actorMemberId: string, chore: Chore, now: Date): Promise<void> {
    const where = {
      houseId,
      choreId: chore.id,
      status: { in: ['TODO', 'UNASSIGNED'] as ('TODO' | 'UNASSIGNED')[] },
      dueAt: { gt: now },
    };
    const actor = await actorOfMember(this.prisma, actorMemberId);
    const outbox = this.events.outbox();
    await this.prisma.$transaction(async (tx) => {
      const ids = (await tx.choreAssignment.findMany({ where, select: { id: true } })).map((r) => r.id);
      if (ids.length > 0) {
        await tx.choreAssignment.updateMany({ where: { ...where, id: { in: ids } }, data: { status: 'CANCELLED', version: { increment: 1 } } });
        await this.debts.onAssignmentsCancelled(tx, outbox, ids, now);
        outbox.toHouse(houseId, 'chore:cancelled', { choreId: chore.id, assignmentIds: ids }, actor);
      }
      await this.audit.log(houseId, actorMemberId, 'CHORE_DEACTIVATED', { choreId: chore.id, cancelled: ids.length }, {}, tx);
      await this.activity.record(tx, outbox, { houseId, type: 'chore.paused', actor, params: { choreId: chore.id, choreTitle: chore.title, cancelled: ids.length } });
    });
    outbox.flush();
  }
}

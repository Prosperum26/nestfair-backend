import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { Chore, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ChoreDebtService } from '../swaps/chore-debt.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { actorOfMember } from '../events/actor.js';
import { EventsService, type Outbox } from '../events/events.service.js';
import { AuditService } from './audit.service.js';
import { hasChoreHistory } from './chore-history.js';
import { ScheduleService } from './schedule.service.js';
import { normalizeChore } from './chore-rules.js';
import { dateOf } from './schedule-context.js';
import { addDays, dueAtOf, toDateStr, weekKeyFromStart, weekStartOf } from './week.js';
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
  archivedAt: c.archivedAt ? c.archivedAt.toISOString() : null,
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
    private readonly schedule: ScheduleService,
  ) {}

  async list(houseId: string, opts: { includeInactive?: boolean; archived?: boolean } = {}): Promise<ChoreDto[]> {
    const rows = await this.prisma.chore.findMany({
      // Việc hệ thống ("Việc đột xuất" của vòng quay) không hiện ở danh sách / màn cài đặt.
      // Việc đã lưu trữ chỉ hiện khi hỏi riêng (`archived`), kể cả khi `includeInactive`.
      where: {
        houseId,
        isSystem: false,
        archivedAt: opts.archived ? { not: null } : null,
        ...(opts.archived || opts.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { createdAt: 'asc' },
    });
    const dtos = rows.map(toDto);
    if (!opts.archived) return dtos;
    return Promise.all(dtos.map(async (d) => Object.assign(d, { canPurge: !(await hasChoreHistory(this.prisma, d.id)) })));
  }

  async create(houseId: string, actorMemberId: string, dto: CreateChoreDto, now: Date = new Date()): Promise<ChoreDto> {
    const shape = normalizeChore(dto);
    const row = await this.prisma.chore.create({ data: { houseId, title: dto.title, weight: dto.weight, ...shape } });
    await this.audit.log(houseId, actorMemberId, 'CHORE_CREATED', { choreId: row.id, title: row.title });
    if (row.frequency === 'ADHOC') await this.createAdhocSlot(houseId, row, now);
    return toDto(row);
  }

  /**
   * Việc đột xuất không vào vòng xoay nên cần một ca ngay: nhà 1 người thì giao thẳng cho người đó, nhà đông hơn để UNASSIGNED
   * cho ai đó bấm "Nhận việc". Hạn là hôm nay (giờ VN), hoặc ngày mai nếu giờ hạn hôm nay đã qua.
   */
  private async createAdhocSlot(houseId: string, chore: Chore, now: Date): Promise<void> {
    const members = await this.prisma.houseMember.findMany({ where: { houseId, leftAt: null }, select: { id: true } });
    let date = toDateStr(now);
    if (dueAtOf(date, chore.dueTime).getTime() <= now.getTime()) date = addDays(date, 1);
    const weekStart = weekStartOf(date);
    const assigneeId = members.length === 1 ? members[0].id : null;
    await this.prisma.choreAssignment.create({
      data: {
        houseId,
        choreId: chore.id,
        assigneeId,
        originalAssigneeId: assigneeId,
        weekKey: weekKeyFromStart(weekStart),
        weekStart: dateOf(weekStart),
        occurrenceDate: dateOf(date),
        slotIndex: 0,
        dueAt: dueAtOf(date, chore.dueTime),
        titleSnapshot: chore.title,
        weightSnapshot: chore.weight,
        source: 'ROTATION',
        status: assigneeId ? 'TODO' : 'UNASSIGNED',
      },
    });
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
    if (row.archivedAt) throw coded(HttpStatus.CONFLICT, 'CHORE_ARCHIVED', 'Việc này đã được lưu trữ. Hãy khôi phục trước khi chỉnh sửa.');

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
      await this.schedule.refillChore(houseId, choreId, now);
    }
    return toDto(updated);
  }

  /**
   * "Xóa" ở giao diện = lưu trữ: ẩn việc, không sinh ca mới, giữ lịch sử. Idempotent. Việc đang bật đi qua luồng tắt việc
   * (hủy ca TODO / chưa có người ở tương lai); việc đã tạm ngưng thì chỉ đặt `archivedAt`.
   */
  async archive(houseId: string, actorMemberId: string, choreId: string, now: Date = new Date()): Promise<ChoreDto> {
    const row = await this.prisma.chore.findFirst({ where: { id: choreId, houseId } });
    if (!row) throw new NotFoundException('Không tìm thấy việc này.');
    if (row.isSystem) throw coded(HttpStatus.FORBIDDEN, 'SYSTEM_CHORE', 'Đây là việc hệ thống của vòng quay, không lưu trữ được.');
    if (row.archivedAt) return toDto(row);

    const actor = await actorOfMember(this.prisma, actorMemberId);
    const outbox = this.events.outbox();
    // Cả quá trình nằm trong một transaction: lỗi giữa chừng thì việc không bị đánh dấu lưu trữ nửa vời, thử lại được.
    // Điều kiện `archivedAt: null` để hai lần lưu trữ song song chỉ một bên ghi nhật ký và hủy ca.
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.chore.updateMany({ where: { id: choreId, houseId, archivedAt: null }, data: { archivedAt: now, isActive: false } });
      const current = await tx.chore.findUniqueOrThrow({ where: { id: choreId } });
      if (claimed.count === 0) return current;
      await this.audit.log(houseId, actorMemberId, 'CHORE_ARCHIVED', { choreId, title: row.title }, {}, tx);
      if (row.isActive) {
        await this.deactivateIn(tx, outbox, houseId, actorMemberId, actor, current, now, 'chore.archived');
      } else {
        await this.activity.record(tx, outbox, { houseId, type: 'chore.archived', actor, params: { choreId, choreTitle: row.title, cancelled: 0 } });
      }
      return current;
    });
    outbox.flush();
    return toDto(updated);
  }

  /** Khôi phục về trạng thái tạm ngưng (`isActive` vẫn false): trưởng phòng bấm "Bật lại" thì mới sinh ca. */
  async restore(houseId: string, actorMemberId: string, choreId: string): Promise<ChoreDto> {
    const row = await this.prisma.chore.findFirst({ where: { id: choreId, houseId } });
    if (!row) throw new NotFoundException('Không tìm thấy việc này.');
    if (!row.archivedAt) throw coded(HttpStatus.CONFLICT, 'CHORE_NOT_ARCHIVED', 'Việc này chưa được lưu trữ.');
    const updated = await this.prisma.chore.update({ where: { id: choreId }, data: { archivedAt: null } });
    await this.audit.log(houseId, actorMemberId, 'CHORE_RESTORED', { choreId, title: row.title });
    return toDto(updated);
  }

  /**
   * Xóa hẳn khỏi DB, chỉ cho việc đã lưu trữ và chưa từng có hoạt động. Khóa dòng việc rồi kiểm lại trong cùng transaction,
   * để một lần xóa song song hoặc một check-in đang diễn ra không lọt qua điều kiện. Ca CANCELLED / TODO của việc xóa theo (cascade).
   */
  async purge(houseId: string, actorMemberId: string, choreId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ title: string; archivedAt: Date | null }[]>`
        SELECT "title", "archivedAt" FROM "chores" WHERE "id" = ${choreId}::uuid AND "houseId" = ${houseId}::uuid AND "isSystem" = false FOR UPDATE`;
      const row = locked[0];
      if (!row) throw new NotFoundException('Không tìm thấy việc này.');
      if (!row.archivedAt) throw coded(HttpStatus.CONFLICT, 'CHORE_NOT_ARCHIVED', 'Hãy lưu trữ việc này trước khi xóa vĩnh viễn.');
      if (await hasChoreHistory(tx, choreId)) {
        throw coded(HttpStatus.CONFLICT, 'CHORE_HAS_HISTORY', 'Việc này đã có lịch sử nên chỉ lưu trữ được, không xóa vĩnh viễn.');
      }
      await tx.chore.delete({ where: { id: choreId } });
      await this.audit.log(houseId, actorMemberId, 'CHORE_PURGED', { choreId, title: row.title }, {}, tx);
    });
  }

  /**
   * S-28: tắt việc thì ca TODO / chưa có người ở tương lai thành CANCELLED (lịch sử giữ nguyên).
   * Hủy ca, nhật ký và Live Ticker (một mục cho cả việc) ghi cùng một transaction.
   */
  private async deactivate(houseId: string, actorMemberId: string, chore: Chore, now: Date): Promise<void> {
    const actor = await actorOfMember(this.prisma, actorMemberId);
    const outbox = this.events.outbox();
    await this.prisma.$transaction((tx) => this.deactivateIn(tx, outbox, houseId, actorMemberId, actor, chore, now, 'chore.paused'));
    outbox.flush();
  }

  /** Phần hủy ca của việc tắt / lưu trữ, chạy trong transaction của người gọi. */
  private async deactivateIn(
    tx: Prisma.TransactionClient,
    outbox: Outbox,
    houseId: string,
    actorMemberId: string,
    actor: Awaited<ReturnType<typeof actorOfMember>>,
    chore: Chore,
    now: Date,
    activityType: 'chore.paused' | 'chore.archived',
  ): Promise<void> {
    const where = {
      houseId,
      choreId: chore.id,
      status: { in: ['TODO', 'UNASSIGNED'] as ('TODO' | 'UNASSIGNED')[] },
      dueAt: { gt: now },
    };
    const ids = (await tx.choreAssignment.findMany({ where, select: { id: true } })).map((r) => r.id);
    if (ids.length > 0) {
      await tx.choreAssignment.updateMany({ where: { ...where, id: { in: ids } }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      await this.debts.onAssignmentsCancelled(tx, outbox, ids, now);
      outbox.toHouse(houseId, 'chore:cancelled', { choreId: chore.id, assignmentIds: ids }, actor);
    }
    await this.audit.log(houseId, actorMemberId, 'CHORE_DEACTIVATED', { choreId: chore.id, cancelled: ids.length }, {}, tx);
    await this.activity.record(tx, outbox, { houseId, type: activityType, actor, params: { choreId: chore.id, choreTitle: chore.title, cancelled: ids.length } });
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditLogDto } from './dto/absence.dto.js';
import { openAtOf, addDays, type DateStr } from './week.js';
import type { Db } from './schedule-context.js';

export interface AuditRef {
  assignmentId?: string;
  scheduleId?: string;
}

/** Nhật ký mọi thao tác override / re-roll / duyệt tự động / khai vắng (ChoreAuditLog). `actorId` là HouseMember.id. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ghi một dòng. Truyền `db` (client của transaction) để ghi cùng transaction với thao tác gốc. */
  async log(
    houseId: string,
    actorId: string | null,
    action: string,
    detail: Prisma.InputJsonValue,
    ref: AuditRef = {},
    db: Db = this.prisma,
  ): Promise<void> {
    await db.choreAuditLog.create({
      data: { houseId, actorId, action, detail, assignmentId: ref.assignmentId, scheduleId: ref.scheduleId },
    });
  }

  /** Mới nhất trước; `weekStart` thì chỉ lấy thao tác trong tuần đó (giờ nhà), ngược lại 100 dòng gần nhất. */
  async list(houseId: string, weekStart?: DateStr): Promise<AuditLogDto[]> {
    const where: Prisma.ChoreAuditLogWhereInput = { houseId };
    if (weekStart) where.createdAt = { gte: openAtOf(weekStart), lt: openAtOf(addDays(weekStart, 7)) };
    const rows = await this.prisma.choreAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const members = actorIds.length
      ? await this.prisma.houseMember.findMany({ where: { id: { in: actorIds } }, select: { id: true, user: { select: { fullName: true } } } })
      : [];
    const names = new Map(members.map((m) => [m.id, m.user.fullName]));
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorId: r.actorId,
      actorName: r.actorId ? (names.get(r.actorId) ?? null) : null,
      assignmentId: r.assignmentId,
      scheduleId: r.scheduleId,
      detail: r.detail as Record<string, unknown>,
      createdAt: r.createdAt,
    }));
  }
}

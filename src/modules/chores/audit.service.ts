import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Db } from './schedule-context.js';

export interface AuditRef {
  assignmentId?: string;
  scheduleId?: string;
}

/** Nhật ký mọi thao tác override / re-roll / duyệt tự động / khai vắng (ChoreAuditLog). */
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

  list(houseId: string, take = 100) {
    return this.prisma.choreAuditLog.findMany({ where: { houseId }, orderBy: { createdAt: 'desc' }, take });
  }
}

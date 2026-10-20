import { Injectable } from '@nestjs/common';
import type { HouseActivity, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { ActivityVisibility } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { EventActor, Outbox } from '../events/events.service.js';
import type { ActivityDto } from './dto/activity.dto.js';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Loại hoạt động lên ticker. Câu chữ ghép ở client từ `type + params` (đặc tả #5 mục 10.3).
 * Mẫu cho #6, #7 (`swap.accepted`, `expense.created`, `debt.settled`) đã có sẵn ở client.
 */
export type ActivityType =
  | 'chore.submitted'
  | 'chore.verified'
  | 'chore.rejected'
  | 'chore.missed'
  | 'chore.auto_approved'
  | 'chore.missed_streak'
  | 'chore.paused'
  | 'schedule.generated'
  | 'schedule.rerolled'
  | 'override.force_done'
  | 'override.force_reject'
  | 'override.reassign'
  | 'override.cancel'
  | 'absence.created'
  | 'break.created'
  | 'wheel.result'
  | 'wheel.voided'
  | 'member.joined'
  | 'member.left'
  | 'swap.accepted'
  | 'expense.created'
  | 'debt.settled';

export interface ActivityInput {
  houseId: string;
  type: ActivityType;
  /** null = hệ thống (cron). */
  actor: EventActor | null;
  /** Chỉ dữ liệu không nhạy cảm: không lý do, không số tiền quà, không URL ảnh (mục 10.3). */
  params: Prisma.InputJsonObject;
  visibility?: ActivityVisibility;
  /** Cùng khóa trong một nhà chỉ ghi một lần (retry, cron chạy lại). */
  dedupeKey?: string;
}

/** Tên hiển thị khi không có người gây ra (cron). */
export const SYSTEM_ACTOR_NAME = 'NestFair';
/** Giữ hoạt động bấy nhiêu ngày. */
export const ACTIVITY_RETENTION_DAYS = 30;
export const ACTIVITY_PAGE_MAX = 50;
/** Bù sau reconnect: tối đa bấy nhiêu mục mới nhất. */
export const ACTIVITY_SINCE_MAX = 100;

export function toActivityDto(r: HouseActivity): ActivityDto {
  return {
    id: r.id,
    type: r.type,
    actorUserId: r.actorUserId,
    actorName: r.actorName,
    params: r.params as Record<string, unknown>,
    createdAt: r.createdAt,
  };
}

/** Bảng tin hoạt động của nhà (Live Ticker). */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ghi một hoạt động bằng `db` (client của transaction nghiệp vụ) và xếp `activity:new` vào `outbox`
   * (chỉ phát khi transaction commit). `ADMIN_ONLY` thì gửi riêng room user của các Admin.
   * Trùng `dedupeKey` thì bỏ qua, trả null.
   */
  async record(db: Db, outbox: Outbox, input: ActivityInput): Promise<ActivityDto | null> {
    const [row] = await db.houseActivity.createManyAndReturn({
      data: [
        {
          houseId: input.houseId,
          type: input.type,
          actorUserId: input.actor?.userId ?? null,
          actorName: input.actor?.name ?? SYSTEM_ACTOR_NAME,
          params: input.params,
          visibility: input.visibility ?? 'HOUSE',
          dedupeKey: input.dedupeKey ?? null,
        },
      ],
      skipDuplicates: true,
    });
    if (!row) return null;
    const activity = toActivityDto(row);
    if (row.visibility === 'HOUSE') {
      outbox.toHouse(input.houseId, 'activity:new', { activity }, input.actor);
    } else {
      const admins = await db.houseMember.findMany({ where: { houseId: input.houseId, role: 'ADMIN', leftAt: null }, select: { userId: true } });
      for (const a of admins) outbox.toUser(a.userId, 'activity:new', { activity }, { houseId: input.houseId, actor: input.actor });
    }
    return activity;
  }

  /**
   * Mới nhất trước. `since`: các mục sau mốc đó (bù sau reconnect, tối đa 100);
   * ngược lại `limit` mục trước `before` (cuộn thêm). Thành viên thường không thấy mục `ADMIN_ONLY`.
   */
  async list(houseId: string, isAdmin: boolean, q: { limit?: number; before?: Date; since?: Date }): Promise<ActivityDto[]> {
    const where: Prisma.HouseActivityWhereInput = { houseId, ...(isAdmin ? {} : { visibility: 'HOUSE' }) };
    if (q.since) where.createdAt = { gt: q.since };
    else if (q.before) where.createdAt = { lt: q.before };
    const take = q.since ? ACTIVITY_SINCE_MAX : Math.min(q.limit ?? 20, ACTIVITY_PAGE_MAX);
    const rows = await this.prisma.houseActivity.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take });
    return rows.map(toActivityDto);
  }

  /** Xóa hoạt động cũ hơn 30 ngày. Trả số dòng đã xóa. */
  async cleanup(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    const { count } = await this.prisma.houseActivity.deleteMany({
      where: {
        createdAt: { lt: new Date(now.getTime() - ACTIVITY_RETENTION_DAYS * 24 * 3_600_000) },
        ...(houseIds ? { houseId: { in: houseIds } } : {}),
      },
    });
    return count;
  }
}

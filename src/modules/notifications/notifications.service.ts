import { HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { NotificationType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DEFAULT_NOTIFICATION_PAGE, type ListNotificationsQuery } from './dto/list-notifications.query.js';
import type { NotificationDto, NotificationListDto } from './dto/notification.dto.js';
import { allowedByPrefs } from './notification-rules.js';

/** Client Prisma thường hoặc client trong transaction. */
type Db = PrismaService | Prisma.TransactionClient;

export interface NotificationInput {
  userId: string;
  houseId: string;
  type: NotificationType;
  /** Chỉ chứa dữ liệu người nhận vốn được xem (tên, số tiền của chính họ). */
  params: Record<string, string | number>;
  /** Chống tạo hai lần cho cùng một sự kiện. */
  dedupeKey: string;
}

/**
 * Hộp thông báo cá nhân (chuông). Riêng tư theo người: mọi truy vấn kèm userId lấy từ JWT, không route nào
 * trả thông báo của người khác. Chỉ ghi dòng thông báo; realtime dùng các sự kiện socket đã có
 * (`expense:new`, `settlement:requested`, `reminder:due`) để client tải lại.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tạo thông báo cho những người còn bật công tắc tương ứng trong Hồ sơ. Gọi được trong transaction của
   * nghiệp vụ chính (`db = tx`) để thông báo và dữ liệu cùng thành công hoặc cùng hủy. Trùng `dedupeKey`
   * thì bỏ qua êm.
   */
  async notify(db: Db, inputs: readonly NotificationInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const users = await db.user.findMany({
      where: { id: { in: [...new Set(inputs.map((i) => i.userId))] } },
      select: { id: true, notificationPrefs: true },
    });
    const prefs = new Map(users.map((u) => [u.id, u.notificationPrefs]));
    const data = inputs.filter((i) => prefs.has(i.userId) && allowedByPrefs(i.type, prefs.get(i.userId)));
    if (data.length === 0) return 0;
    const { count } = await db.notification.createMany({ data, skipDuplicates: true });
    return count;
  }

  /** Thông báo mới nhất của CHÍNH người gọi, kèm số chưa đọc. `houseId` chỉ lọc trên các dòng của chính họ. */
  async list(userId: string, query: ListNotificationsQuery): Promise<NotificationListDto> {
    const where = { userId, ...(query.houseId ? { houseId: query.houseId } : {}) };
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit ?? DEFAULT_NOTIFICATION_PAGE,
      }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { items: rows.map(toDto), unreadCount };
  }

  /** Đánh dấu một thông báo đã đọc. Thông báo của người khác trả 404 như không tồn tại. Gọi lại không đổi gì. */
  async markRead(userId: string, id: string, now = new Date()): Promise<NotificationDto> {
    const row = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw coded(HttpStatus.NOT_FOUND, 'NOTIFICATION_NOT_FOUND', 'Không tìm thấy thông báo.');
    if (row.readAt) return toDto(row);
    return toDto(await this.prisma.notification.update({ where: { id }, data: { readAt: now } }));
  }

  /** Đánh dấu mọi thông báo chưa đọc của người gọi (trong một nhà nếu có `houseId`) là đã đọc. */
  async markAllRead(userId: string, houseId: string | undefined, now = new Date()): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(houseId ? { houseId } : {}) },
      data: { readAt: now },
    });
    return { updated: count };
  }
}

function toDto(row: {
  id: string;
  houseId: string;
  type: NotificationType;
  params: unknown;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: row.id,
    houseId: row.houseId,
    type: row.type,
    params: row.params as Record<string, string | number>,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

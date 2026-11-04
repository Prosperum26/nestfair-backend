import { HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ReminderSource } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateReminderDto } from './dto/create-reminder.dto.js';
import { DEFAULT_REMINDER_PAGE, type ListRemindersQuery } from './dto/list-reminders.query.js';
import type { ReminderDto } from './dto/reminder.dto.js';
import type { UpdateReminderDto } from './dto/update-reminder.dto.js';

/** D7: remindAt chỉ được trước hiện tại tối đa 1 năm. */
const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** Bấm nút gợi ý hai lần bị @@unique([userId, dedupeKey]) chặn → chuyển thành 409 thân thiện. */
const isUniqueViolation = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

type ReminderRow = {
  id: string;
  houseId: string;
  title: string;
  remindAt: Date;
  source: ReminderSource;
  sentAt: Date | null;
};

/**
 * Nhắc nhở việc cá nhân (Issue #12, thẻ BE-4). Riêng tư theo người: mọi truy vấn đều kèm userId
 * lấy từ JWT — không bao giờ trả nhắc của người khác, kể cả bạn cùng phòng.
 */
@Injectable()
export class RemindersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Danh sách nhắc của CHÍNH người gọi (mọi nhà). `upcoming` (mặc định) = chưa gửi (sentAt null);
   * `all` = mọi nhắc kể cả đã gửi. Cả hai xếp remindAt tăng dần.
   */
  async list(userId: string, query: ListRemindersQuery): Promise<ReminderDto[]> {
    const rows = await this.prisma.reminder.findMany({
      where: { userId, ...(query.state === 'all' ? {} : { sentAt: null }) },
      orderBy: [{ remindAt: 'asc' }, { id: 'asc' }],
      take: query.limit ?? DEFAULT_REMINDER_PAGE,
    });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Tạo nhắc. Không có sourceMessageId → nhắc tự tạo (USER). Có → phải là tin nhắn Trợ lý của chính
   * người gọi và actionIndex trỏ đúng hành động CREATE_REMINDER đã làm sạch khi lưu; dedupeKey
   * `msg:<messageId>:<actionIndex>` chống bấm nút hai lần (409 nhờ unique constraint).
   */
  async create(userId: string, dto: CreateReminderDto, now = new Date()): Promise<ReminderDto> {
    const member = await this.prisma.houseMember.findFirst({
      where: { houseId: dto.houseId, userId, leftAt: null },
      select: { id: true },
    });
    if (!member) {
      throw coded(HttpStatus.FORBIDDEN, 'HOUSE_FORBIDDEN', 'Bạn không phải thành viên còn hoạt động của nhà này.');
    }

    const remindAt = this.checkRemindAt(dto.remindAt, now);

    let source: ReminderSource = ReminderSource.USER;
    let dedupeKey: string | undefined;
    if (dto.sourceMessageId !== undefined || dto.actionIndex !== undefined) {
      if (dto.sourceMessageId === undefined || dto.actionIndex === undefined) {
        throw coded(
          HttpStatus.BAD_REQUEST,
          'REMINDER_SOURCE_INVALID',
          'Khi tạo nhắc từ gợi ý của Trợ lý, cần gửi đủ cả sourceMessageId và actionIndex.',
        );
      }
      const message = await this.prisma.assistantMessage.findUnique({
        where: { id: dto.sourceMessageId },
        select: { userId: true, actionsJson: true },
      });
      if (!message || message.userId !== userId) {
        throw coded(HttpStatus.NOT_FOUND, 'MESSAGE_NOT_FOUND', 'Không tìm thấy tin nhắn Trợ lý.');
      }
      if (!this.isCreateReminderAction(message.actionsJson, dto.actionIndex)) {
        throw coded(
          HttpStatus.BAD_REQUEST,
          'REMINDER_ACTION_INVALID',
          'Hành động được chọn không phải hành động tạo nhắc nhở.',
        );
      }
      source = ReminderSource.ASSISTANT;
      dedupeKey = 'msg:' + dto.sourceMessageId + ':' + dto.actionIndex;
    }

    try {
      const row = await this.prisma.reminder.create({
        data: {
          userId,
          houseId: dto.houseId,
          title: dto.title,
          remindAt,
          source,
          ...(dedupeKey ? { dedupeKey } : {}),
        },
      });
      return this.toDto(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw coded(HttpStatus.CONFLICT, 'REMINDER_ALREADY_CREATED', 'Nhắc nhở cho gợi ý này đã được tạo rồi.');
      }
      throw error;
    }
  }

  /**
   * Sửa nhắc của chính mình. Đã gửi (sentAt != null) thì không sửa được nữa (409). SYSTEM vẫn sửa
   * được giờ (D12). Đổi remindAt thì phải vẫn thỏa quy tắc tương lai + trong 1 năm.
   */
  async update(userId: string, id: string, dto: UpdateReminderDto, now = new Date()): Promise<ReminderDto> {
    const row = await this.prisma.reminder.findUnique({ where: { id } });
    if (!row || row.userId !== userId) {
      throw coded(HttpStatus.NOT_FOUND, 'REMINDER_NOT_FOUND', 'Không tìm thấy nhắc nhở.');
    }
    if (row.sentAt) {
      throw coded(HttpStatus.CONFLICT, 'REMINDER_ALREADY_SENT', 'Nhắc nhở đã gửi rồi nên không sửa được.');
    }

    const data: Prisma.ReminderUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.remindAt !== undefined) data.remindAt = this.checkRemindAt(dto.remindAt, now);
    return this.toDto(await this.prisma.reminder.update({ where: { id }, data }));
  }

  /**
   * Xóa nhắc của chính mình; nhắc đã gửi vẫn xóa được (dọn lịch sử). Nhắc SYSTEM không xóa được
   * (D12: hệ thống chỉ cho sửa giờ) → 403 REMINDER_NOT_DELETABLE.
   */
  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const row = await this.prisma.reminder.findUnique({ where: { id } });
    if (!row || row.userId !== userId) {
      throw coded(HttpStatus.NOT_FOUND, 'REMINDER_NOT_FOUND', 'Không tìm thấy nhắc nhở.');
    }
    if (row.source === ReminderSource.SYSTEM) {
      throw coded(HttpStatus.FORBIDDEN, 'REMINDER_NOT_DELETABLE', 'Nhắc nhở của hệ thống chỉ chỉnh sửa được, không xóa được.');
    }
    await this.prisma.reminder.delete({ where: { id } });
    return { ok: true };
  }

  /** remindAt phải strictly sau hiện tại và không quá 1 năm, sai → 400 REMIND_AT_INVALID. */
  private checkRemindAt(value: string, now: Date): Date {
    const t = Date.parse(value);
    if (!Number.isFinite(t) || t <= now.getTime() || t - now.getTime() > MAX_AHEAD_MS) {
      throw coded(HttpStatus.BAD_REQUEST, 'REMIND_AT_INVALID', 'Thời gian nhắc phải sau hiện tại và trong vòng 1 năm.');
    }
    return new Date(t);
  }

  /** Đọc lại mảng hành động đã làm sạch khi lưu: không tin dữ liệu trong DB, sai cấu trúc thì coi như không có. */
  private isCreateReminderAction(json: Prisma.JsonValue | null, index: number): boolean {
    if (!Array.isArray(json) || index < 0 || index >= json.length) return false;
    const action: unknown = json[index];
    return (
      typeof action === 'object' && action !== null && !Array.isArray(action) &&
      (action as { type?: unknown }).type === 'CREATE_REMINDER'
    );
  }

  private toDto(row: ReminderRow): ReminderDto {
    return {
      id: row.id,
      houseId: row.houseId,
      title: row.title,
      remindAt: row.remindAt.toISOString(),
      source: row.source,
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    };
  }
}

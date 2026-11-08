import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Env } from '../../config/env.validation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AssistantRole, ReminderSource } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { dateOf } from '../chores/schedule-context.js';
import { type DateStr, dueAtOf, toDateStr } from '../chores/week.js';
import { EventsService } from '../events/events.service.js';
import { resolveNotificationPrefs } from '../users/notification-prefs.js';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * Nguồn nội dung bản tin hằng ngày (quyết định D6): mỗi nguồn tự trả các dòng đã hoàn chỉnh cho
 * (userId, houseId, ngày VN); cron chỉ ghép các dòng lại. Issue đổi ca sau này cắm thêm nguồn vào
 * token `DIGEST_SOURCES` của SchedulerModule, không phải sửa cron này.
 */
export interface DigestSource {
  linesFor(userId: string, houseId: string, day: DateStr): Promise<string[]>;
}

/** Token provider: mảng các DigestSource, mặc định chỉ có ca trực hôm nay. */
export const DIGEST_SOURCES = 'DIGEST_SOURCES';

/** Giờ phát bản tin hằng ngày, giờ Việt Nam. */
export const DIGEST_HHMM = '08:00';

/** "HH:mm" giờ Việt Nam (UTC+7, không có DST) của một thời điểm. */
const vnHhmm = (d: Date): string => {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
};

/** Nguồn mặc định: dòng "Hôm nay bạn có N ca: <việc> (đến HH:mm), …" từ ca TODO hôm nay của chính người đó. */
@Injectable()
export class ChoreTodayDigestSource implements DigestSource {
  constructor(private readonly prisma: PrismaService) {}

  async linesFor(userId: string, houseId: string, day: DateStr): Promise<string[]> {
    // Người dùng tắt "bản tin việc nhà" ở Hồ sơ thì không báo ca nào.
    const owner = await this.prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    if (!resolveNotificationPrefs(owner?.notificationPrefs).choreDigest) return [];
    const shifts = await this.prisma.choreAssignment.findMany({
      where: { houseId, assignee: { userId, leftAt: null }, status: 'TODO', occurrenceDate: dateOf(day) },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: { titleSnapshot: true, dueAt: true },
    });
    if (shifts.length === 0) return [];
    const list = shifts.map((s) => `${s.titleSnapshot} (đến ${vnHhmm(s.dueAt)})`).join(', ');
    return [`Hôm nay bạn có ${shifts.length} ca: ${list}`];
  }
}

type DueReminder = { id: string; userId: string; houseId: string; title: string };
type LatestThread = { userId: string; houseId: string; threadId: string };
type MessageCreate = NonNullable<Parameters<Prisma.TransactionClient['assistantMessage']['createMany']>[0]>['data'];

/**
 * Cron nhắc nhở (Issue #12, thẻ BE-5). Hai job đều an toàn khi chạy nhiều instance / chồng lấn:
 * gửi nhắc khoá dòng bằng `FOR UPDATE SKIP LOCKED`, bản tin hằng ngày dedupe bằng unique
 * `@@unique([userId, dedupeKey])`. Socket chỉ bắn SAU khi transaction commit.
 * Mỗi job có hai lớp: phương thức logic (tham số `now` / `houseIds` để test gọi trực tiếp) và
 * hàm `@Cron` mỏng bên dưới (bỏ qua khi NODE_ENV=test).
 */
@Injectable()
export class ReminderCronService {
  private readonly logger = new Logger(ReminderCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    @Inject(DIGEST_SOURCES) private readonly digestSources: DigestSource[],
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get isTest() {
    return this.config.get('NODE_ENV', { infer: true }) === 'test';
  }

  // ---- Gửi nhắc đến hạn ----

  /**
   * Mỗi phút: khoá + đánh dấu `sentAt` + ghi tin SYSTEM vào thread mới nhất trong MỘT transaction
   * (`FOR UPDATE SKIP LOCKED` nên hai lượt chồng nhau mỗi nhắc chỉ được xử lý đúng một lần; server
   * ngủ lâu thì bù ở tick sau, vẫn đúng một lần nhờ điều kiện `sentAt IS NULL`). Socket `reminder:due`
   * chỉ bắn sau khi commit — rollback thì không bắn.
   */
  /** `houseIds`: chỉ quét nhắc của các nhà này (test dùng để không chạm dữ liệu của file khác). */
  async dispatchDue(now: Date = new Date(), houseIds?: string[]): Promise<{ sent: number }> {
    const at = now.toISOString();
    const sent = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<DueReminder[]>(Prisma.sql`
        WITH due AS (
          SELECT id FROM reminders
          WHERE "sentAt" IS NULL AND "remindAt" <= ${at}::timestamp
          ${houseIds ? Prisma.sql`AND "houseId" = ANY(${houseIds}::uuid[])` : Prisma.empty}
          ORDER BY "remindAt", id
          LIMIT 200
          FOR UPDATE SKIP LOCKED
        )
        UPDATE reminders r SET "sentAt" = ${at}::timestamp
        FROM due WHERE r.id = due.id
        RETURNING r.id, r."userId", r."houseId", r.title`);
      if (rows.length > 0) {
        const data = await this.systemMessages(tx, rows);
        await tx.assistantMessage.createMany({ data });
      }
      return rows;
    });
    for (const r of sent) {
      this.events.emitToUser(r.userId, 'reminder:due', { reminderId: r.id, title: r.title });
    }
    return { sent: sent.length };
  }

  // ---- Bản tin hằng ngày ----

  /**
   * 08:00 hằng ngày giờ VN: với mỗi thành viên còn ở nhà mà hôm nay có dòng nào cần báo (mặc định là
   * ca TODO hôm nay), tạo MỘT nhắc SYSTEM `dedupeKey: digest:<YYYY-MM-DD>` (chạy hai lần chỉ tạo một
   * nhờ unique constraint), ghi tin SYSTEM vào thread mới nhất và bắn `reminder:due` sau khi commit.
   * `houseIds` rỗng = mọi nhà. Người đã rời nhà / không có gì hôm nay → không tạo gì.
   */
  async sendDailyDigest(now: Date = new Date(), houseIds: string[] = []): Promise<{ created: number }> {
    const day = toDateStr(now); // ngày Việt Nam của thời điểm chạy
    const dedupeKey = 'digest:' + day;
    const remindAt = dueAtOf(day, DIGEST_HHMM);
    const members = await this.prisma.houseMember.findMany({
      where: { leftAt: null, ...(houseIds.length > 0 ? { houseId: { in: houseIds } } : {}) },
      orderBy: [{ houseId: 'asc' }, { userId: 'asc' }],
      select: { userId: true, houseId: true },
    });

    let created = 0;
    for (const m of members) {
      try {
        const title = await this.digestTitle(m.userId, m.houseId, day);
        if (title === null) continue; // hôm nay không có gì → không tạo gì cả
        const reminder = await this.prisma.$transaction(async (tx) => {
          const row = await tx.reminder.create({
            data: { userId: m.userId, houseId: m.houseId, title, remindAt, sentAt: now, source: ReminderSource.SYSTEM, dedupeKey },
          });
          const data = await this.systemMessages(tx, [row]);
          await tx.assistantMessage.createMany({ data });
          return row;
        });
        created++;
        this.events.emitToUser(m.userId, 'reminder:due', { reminderId: reminder.id, title });
      } catch (e) {
        // Unique (userId, dedupeKey): digest của ngày này đã tạo rồi thì bỏ qua.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        // Một người lỗi không được chặn các người còn lại.
        this.logger.error(`Tạo digest ${day} cho user ${m.userId} thất bại`, e as Error);
      }
    }
    return { created };
  }

  /** Ghép các dòng của mọi nguồn, mỗi nguồn một dòng, nối bằng xuống dòng; không dòng nào → null. */
  private async digestTitle(userId: string, houseId: string, day: DateStr): Promise<string | null> {
    const lines: string[] = [];
    for (const source of this.digestSources) {
      try {
        for (const line of await source.linesFor(userId, houseId, day)) {
          if (line !== '') lines.push(line);
        }
      } catch (e) {
        this.logger.error(`Nguồn digest ${source.constructor.name} lỗi, bỏ qua dòng của nó`, e as Error);
      }
    }
    return lines.length > 0 ? lines.join('\n') : null;
  }

  /**
   * Tin SYSTEM cho từng dòng nhắc: dùng thread mới nhất của (userId, houseId) — tin AssistantMessage
   * cuối cùng — chưa từng chat thì mở thread mới. Tra `DISTINCT ON` một truy vấn cho cả lô.
   */
  private async systemMessages(tx: Prisma.TransactionClient, rows: DueReminder[]): Promise<MessageCreate> {
    const pairOf = (r: { userId: string; houseId: string }) => r.userId + '|' + r.houseId;
    const pairs = [...new Map(rows.map((r) => [pairOf(r), { userId: r.userId, houseId: r.houseId }])).values()];
    const latest =
      pairs.length === 0
        ? []
        : await tx.$queryRaw<LatestThread[]>(Prisma.sql`
            SELECT DISTINCT ON ("userId", "houseId") "userId", "houseId", "threadId"
            FROM assistant_messages
            WHERE ("userId", "houseId") IN (${Prisma.join(pairs.map((p) => Prisma.sql`(${p.userId}::uuid, ${p.houseId}::uuid)`))})
            ORDER BY "userId", "houseId", "createdAt" DESC, id DESC`);
    const threads = new Map<string, string>();
    for (const p of pairs) threads.set(pairOf(p), latest.find((l) => pairOf(l) === pairOf(p))?.threadId ?? randomUUID());
    return rows.map((r) => ({
      userId: r.userId,
      houseId: r.houseId,
      threadId: threads.get(pairOf(r))!,
      role: AssistantRole.SYSTEM,
      content: r.title,
    }));
  }

  // ---- Lịch chạy (bỏ qua ở môi trường test) ----

  private async guarded(name: string, job: () => Promise<unknown>) {
    if (this.isTest) return;
    try {
      await job();
    } catch (e) {
      this.logger.error(`Job ${name} thất bại`, e as Error);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: TIME_ZONE })
  cronDispatchDue() {
    return this.guarded('dispatchDue', () => this.dispatchDue());
  }

  @Cron('0 8 * * *', { timeZone: TIME_ZONE })
  cronSendDailyDigest() {
    return this.guarded('sendDailyDigest', () => this.sendDailyDigest());
  }
}

import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import { vnDayStart } from '../../common/vn-day.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AssistantCategory, AssistantRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { weekKeyOf } from '../chores/week.js';
import type { HouseMembership } from '../houses/guards/house-member.guard.js';
import { buildAssistantContext, MAX_HISTORY_MESSAGES } from './assistant-context.js';
import { ASSISTANT_GENERATOR, type AssistantGenerator } from './assistant-generator.js';
import { AssistantGenError, type SafeAction, sanitizeReply, type SanitizedReply } from './assistant-schema.js';
import { type AssistantMessageDto, type AssistantMessagesPageDto, type SendMessageResultDto } from './dto/assistant-message.dto.js';
import { DEFAULT_MESSAGE_PAGE, type ListMessagesQuery } from './dto/list-messages.query.js';
import type { SendMessageDto } from './dto/send-message.dto.js';

/** Đặc tả VI.5 / D9: tối đa 30 tin USER mỗi người mỗi ngày (giờ VN), tính trên mọi nhà. */
export const DAILY_MESSAGE_LIMIT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** D10: nội dung tin dự phòng khi không sinh được câu trả lời dùng được. */
export const ASSISTANT_FALLBACK = 'Trợ lý đang bận, thử lại sau ít phút';

type MessageRow = {
  id: string;
  threadId: string;
  role: AssistantRole;
  content: string;
  category: AssistantCategory | null;
  actionsJson: Prisma.JsonValue | null;
  createdAt: Date;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_TYPES = new Set<string>(['CREATE_REMINDER', 'CREATE_ADHOC_TASK', 'DRAFT_EXPENSE']);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Đọc lại mảng hành động đã làm sạch khi lưu: không tin dữ liệu trong DB, sai cấu trúc thì bỏ dòng đó. */
function parseActions(json: Prisma.JsonValue | null): SafeAction[] {
  if (!Array.isArray(json)) return [];
  const out: SafeAction[] = [];
  for (const a of json) {
    if (!isRecord(a) || typeof a.type !== 'string' || !ACTION_TYPES.has(a.type)) continue;
    if (typeof a.label !== 'string' || a.label === '') continue;
    const p = isRecord(a.payload) ? a.payload : {};
    const payload: SafeAction['payload'] = {};
    if (typeof p.title === 'string' && p.title !== '') payload.title = p.title;
    if (typeof p.remindAt === 'string' && p.remindAt !== '') payload.remindAt = p.remindAt;
    if (typeof p.estimatedAmount === 'number' && Number.isSafeInteger(p.estimatedAmount)) payload.estimatedAmount = p.estimatedAmount;
    out.push({ type: a.type as SafeAction['type'], label: a.label, payload });
  }
  return out;
}

/** Cursor mờ danh nghĩa client không tự ghép được: base64url của "createdAt(id iso)|id". */
const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(createdAt.toISOString() + '|' + id, 'utf8').toString('base64url');

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ASSISTANT_GENERATOR) private readonly generator: AssistantGenerator,
  ) {}

  /**
   * Gửi một tin cho Trợ lý và nhận câu trả lời. Quy tắc sống còn (Issue #12): AI KHÔNG BAO GIỜ TỰ GHI
   * DỮ LIỆU — hành động gợi ý chỉ là nút, người dùng bấm thì client mới gọi API thường.
   * Thứ tự (theo thẻ BE-3): đồng ý (D5) → hạn mức (D9) → ngữ cảnh → lưu tin USER → sinh câu trả lời →
   * hậu kiểm, lỗi thì tin dự phòng (D10) → lưu tin ASSISTANT → trả kèm remaining.
   */
  async send(m: HouseMembership, body: SendMessageDto, now = new Date()): Promise<SendMessageResultDto> {
    // (1) Đồng ý: chưa đồng ý thì chặn trước khi tốn bất kỳ thứ gì.
    const me = await this.prisma.user.findUnique({ where: { id: m.userId }, select: { assistantConsentAt: true } });
    if (!me?.assistantConsentAt) {
      throw coded(HttpStatus.FORBIDDEN, 'ASSISTANT_CONSENT_REQUIRED', 'Bạn chưa đồng ý gửi tin nhắn tới Trợ lý AI (Google Gemini). Bật trong Cài đặt trước nhé.');
    }

    // (2) Hạn mức: 30 tin USER / người / ngày giờ VN, mọi nhà, tính cả lượt AI lỗi (vì tin USER vẫn lưu).
    const used = await this.prisma.assistantMessage.count({
      where: { userId: m.userId, role: AssistantRole.USER, createdAt: { gte: vnDayStart(now) } },
    });
    if (used >= DAILY_MESSAGE_LIMIT) throw this.quotaExceeded(now);

    // (3) Ngữ cảnh tối thiểu (D11, D13): nhà + ca trực tuần này của CHÍNH người hỏi + 10 tin cuối của thread.
    const threadId = body.threadId ?? randomUUID();
    const [house, memberCount, shifts, historyDesc] = await Promise.all([
      this.prisma.house.findUnique({ where: { id: m.houseId }, select: { name: true, rules: true } }),
      this.prisma.houseMember.count({ where: { houseId: m.houseId, leftAt: null } }),
      this.prisma.choreAssignment.findMany({
        where: { houseId: m.houseId, assigneeId: m.id, weekKey: weekKeyOf(now) },
        select: { titleSnapshot: true, dueAt: true, status: true },
        orderBy: { dueAt: 'asc' },
      }),
      body.threadId
        ? this.prisma.assistantMessage.findMany({
            where: { userId: m.userId, houseId: m.houseId, threadId },
            select: { role: true, content: true },
            orderBy: { createdAt: 'desc' },
            take: MAX_HISTORY_MESSAGES,
          })
        : Promise.resolve([]),
    ]);
    if (!house) throw coded(HttpStatus.NOT_FOUND, 'HOUSE_NOT_FOUND', 'Không tìm thấy nhà.');
    const history = historyDesc.slice().reverse(); // cũ → mới cho buildAssistantContext

    // (4) Lưu tin USER trước khi gọi AI: lượt này đã chi hạn mức kể cả khi AI lỗi.
    const userRow = await this.prisma.assistantMessage.create({
      data: { userId: m.userId, houseId: m.houseId, threadId, role: AssistantRole.USER, content: body.content },
    });

    // (5)+(6)+(7) Sinh câu trả lời rồi hậu kiểm; mọi lỗi (TIMEOUT / UNAVAILABLE / UNREADABLE / lạ) đều
    // trở thành tin dự phòng không có hành động — không bao giờ 500, không lộ lỗi gốc của provider.
    const ctx = buildAssistantContext({
      house: { name: house.name, rules: house.rules, memberCount },
      now,
      shifts: shifts.map((s) => ({ title: s.titleSnapshot, dueAt: s.dueAt, status: s.status })),
      history,
      question: body.content,
    });
    let reply: SanitizedReply;
    try {
      reply = sanitizeReply(await this.generator.generate(ctx), now);
    } catch (e) {
      const reason = e instanceof AssistantGenError ? e.code : 'UNKNOWN';
      this.logger.warn('Trợ lý không trả lời được (' + reason + '): ' + (e instanceof Error ? e.message : 'unknown'));
      reply = { reply: ASSISTANT_FALLBACK, category: AssistantCategory.OTHER, actions: [] };
    }

    // (8) Lưu tin ASSISTANT kèm mảng hành động đã làm sạch (nút bấm, chưa thực hiện).
    const assistantRow = await this.prisma.assistantMessage.create({
      data: {
        userId: m.userId,
        houseId: m.houseId,
        threadId,
        role: AssistantRole.ASSISTANT,
        content: reply.reply,
        category: reply.category,
        actionsJson: reply.actions as unknown as Prisma.InputJsonValue,
      },
    });

    // (9) Trả kết quả; done của các nút CREATE_REMINDER tra theo dedupeKey (chống bấm hai lần).
    const done = await this.doneByDedupe(m.userId, [userRow, assistantRow]);
    return {
      threadId,
      userMessage: this.toDto(userRow, done),
      assistantMessage: this.toDto(assistantRow, done),
      remaining: DAILY_MESSAGE_LIMIT - (used + 1),
    };
  }

  /**
   * Đọc lịch sử chat của CHÍNH người gọi trong nhà của membership (chống IDOR: userId/houseId lấy từ
   * membership đã xác thực, không tin tham số client). Không threadId → thread mới nhất. Trang từ cũ
   * đến mới, phân trang keyset theo (createdAt, id).
   */
  async list(m: HouseMembership, query: ListMessagesQuery): Promise<AssistantMessagesPageDto> {
    const limit = query.limit ?? DEFAULT_MESSAGE_PAGE;
    let threadId = query.threadId ?? null;
    if (!threadId) {
      const latest = await this.prisma.assistantMessage.findFirst({
        where: { userId: m.userId, houseId: m.houseId },
        select: { threadId: true },
        orderBy: { createdAt: 'desc' },
      });
      threadId = latest?.threadId ?? null;
    }
    if (!threadId) return { items: [], nextCursor: null, threadId: null };

    const where: Prisma.AssistantMessageWhereInput = { userId: m.userId, houseId: m.houseId, threadId };
    if (query.cursor) Object.assign(where, this.cursorFilter(query.cursor));

    const rows = await this.prisma.assistantMessage.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    if (rows.length === 0) return { items: [], nextCursor: null, threadId: null };

    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).reverse(); // cũ → mới
    const done = await this.doneByDedupe(m.userId, page);
    return {
      items: page.map((r) => this.toDto(r, done)),
      nextCursor: hasMore ? encodeCursor(rows[limit - 1].createdAt, rows[limit - 1].id) : null,
      threadId,
    };
  }

  /**
   * D9: lỗi 429 cần thêm `resetAt` (00:00 giờ VN hôm sau) trong body. `coded()` không nhận payload mở
   * rộng nên dựng HttpException tại đây, vẫn giữ đúng format `{ statusCode, message, error, code, resetAt }`.
   */
  private quotaExceeded(now: Date): HttpException {
    const resetAt = new Date(vnDayStart(now).getTime() + DAY_MS);
    return new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Bạn đã gửi đủ ' + DAILY_MESSAGE_LIMIT + ' tin cho Trợ lý trong hôm nay. Nghỉ ngơi chút, sau 00:00 (giờ Việt Nam) lại nhắn tiếp nhé.',
        error: 'Too Many Requests',
        code: 'ASSISTANT_QUOTA_EXCEEDED',
        resetAt: resetAt.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Giải mã cursor keyset; sai định dạng → 400 thay vì 500. */
  private cursorFilter(cursor: string): Prisma.AssistantMessageWhereInput {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.lastIndexOf('|');
    const createdAtMs = sep > 0 ? Date.parse(decoded.slice(0, sep)) : Number.NaN;
    const id = sep > 0 ? decoded.slice(sep + 1) : '';
    if (!Number.isFinite(createdAtMs) || !UUID_RE.test(id)) {
      throw coded(HttpStatus.BAD_REQUEST, 'INVALID_CURSOR', 'Liên kết phân trang không còn hiệu lực, hãy tải lại trang.');
    }
    const createdAt = new Date(createdAtMs);
    return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] };
  }

  /** MỘT truy vấn Reminder cho cả trang: nút CREATE_REMINDER đã dùng khi Reminder có dedupeKey `msg:<messageId>:<actionIndex>`. */
  private async doneByDedupe(userId: string, rows: MessageRow[]): Promise<Set<string>> {
    const keys: string[] = [];
    for (const row of rows) {
      parseActions(row.actionsJson).forEach((a, i) => {
        if (a.type === 'CREATE_REMINDER') keys.push('msg:' + row.id + ':' + i);
      });
    }
    if (keys.length === 0) return new Set();
    const found = await this.prisma.reminder.findMany({ where: { userId, dedupeKey: { in: keys } }, select: { dedupeKey: true } });
    return new Set(found.map((r) => r.dedupeKey ?? ''));
  }

  private toDto(row: MessageRow, done: Set<string>): AssistantMessageDto {
    const actions = parseActions(row.actionsJson).map((a, i) => ({
      ...a,
      done: a.type === 'CREATE_REMINDER' ? done.has('msg:' + row.id + ':' + i) : false,
    }));
    return {
      id: row.id,
      threadId: row.threadId,
      role: row.role,
      content: row.content,
      category: row.category,
      actions,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

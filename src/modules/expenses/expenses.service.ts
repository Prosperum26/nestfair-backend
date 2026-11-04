import { HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { SplitType } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import type { HouseMembership } from '../houses/guards/house-member.guard.js';
import { CloudinaryService, publicIdFromUrl } from '../uploads/cloudinary.service.js';
import { type UploadedImage, validateImageFile } from '../uploads/image-validation.js';
import { computeSplit, type SplitShare } from './algorithms/split.js';
import { assertItemizedItems, clearAssignees, itemsForStorage, parseStoredItems } from './expense-items.js';
import type { CreateExpenseDto, ExactSplitDto } from './dto/create-expense.dto.js';
import type { ExpenseDto, ExpenseSummaryDto, UploadedUrlDto } from './dto/expense-response.dto.js';
import type { ListExpensesQuery } from './dto/list-expenses.query.js';
import type { UpdateExpenseDto } from './dto/update-expense.dto.js';
import { monthKeyOf, monthRange } from './month.js';

const USER_BRIEF = { select: { id: true, fullName: true, avatarUrl: true } } as const;
const EXPENSE_INCLUDE = {
  payer: USER_BRIEF,
  splits: { include: { user: USER_BRIEF }, orderBy: { allocatedAmount: 'desc' } },
} satisfies Prisma.ExpenseInclude;
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

/** Cho phép ghi ngày chi lệch tới 1 ngày về tương lai (lệch múi giờ thiết bị), xa hơn là gõ nhầm. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

const splitInvalid = (message: string) => coded(HttpStatus.UNPROCESSABLE_ENTITY, 'SPLIT_INVALID', message);
const scanUsed = () => coded(HttpStatus.CONFLICT, 'RECEIPT_SCAN_USED', 'Hóa đơn này đã được ghi vào sổ rồi.');

/** Đầu vào phần chia sau khi gộp DTO với khoản chi cũ (khi sửa). */
interface SplitRequest {
  splitType: SplitType;
  total: number;
  participantIds?: readonly string[];
  splits?: readonly ExactSplitDto[];
  items?: readonly { name: string; lineTotal: number; userIds: string[] }[];
}

/** Món gửi lên → dạng đầu vào của phần chia theo món (userIds thiếu thì rỗng; ITEMIZED đã kiểm ít nhất một người trước đó). */
const splitItems = (items: readonly { name: string; lineTotal: number; userIds?: string[] }[] | undefined) =>
  items?.map((i) => ({ name: i.name, lineTotal: i.lineTotal, userIds: i.userIds ?? [] }));

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly events: EventsService,
  ) {}

  async list(m: HouseMembership, query: ListExpensesQuery, now = new Date()): Promise<ExpenseDto[]> {
    const { start, end } = monthRange(query.month ?? monthKeyOf(now));
    const rows = await this.prisma.expense.findMany({
      where: {
        houseId: m.houseId,
        spentAt: { gte: start, lt: end },
        payerId: query.payerId,
        category: query.category,
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { payer: { fullName: { contains: query.q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: EXPENSE_INCLUDE,
      orderBy: [{ spentAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((e) => this.toDto(e, m));
  }

  /** Thống kê đầu trang sổ chi (ảnh 07): tổng tháng, bạn đã trả, phần của bạn, theo danh mục. Tính bằng aggregate SQL. */
  async summary(m: HouseMembership, month: string | undefined, now = new Date()): Promise<ExpenseSummaryDto> {
    const key = month ?? monthKeyOf(now);
    const { start, end } = monthRange(key);
    const inMonth = { houseId: m.houseId, spentAt: { gte: start, lt: end } };

    const [all, mine, share, categories, participants] = await Promise.all([
      this.prisma.expense.aggregate({ where: inMonth, _sum: { totalAmount: true }, _count: true }),
      this.prisma.expense.aggregate({ where: { ...inMonth, payerId: m.userId }, _sum: { totalAmount: true }, _count: true }),
      this.prisma.expenseSplit.aggregate({ where: { userId: m.userId, expense: inMonth }, _sum: { allocatedAmount: true } }),
      this.prisma.expense.groupBy({
        by: ['category'],
        where: inMonth,
        _sum: { totalAmount: true },
        _count: true,
        orderBy: { _sum: { totalAmount: 'desc' } },
      }),
      this.prisma.expenseSplit.findMany({ where: { expense: inMonth }, distinct: ['userId'], select: { userId: true } }),
    ]);

    const paidByMe = mine._sum.totalAmount ?? 0;
    const myShare = share._sum.allocatedAmount ?? 0;
    return {
      month: key,
      totalAmount: all._sum.totalAmount ?? 0,
      expenseCount: all._count,
      participantCount: participants.length,
      paidByMe,
      paidByMeCount: mine._count,
      myShare,
      diff: paidByMe - myShare,
      byCategory: categories.map((c) => ({ category: c.category, amount: c._sum.totalAmount ?? 0, count: c._count })),
    };
  }

  async get(m: HouseMembership, id: string): Promise<ExpenseDto> {
    return this.toDto(await this.load(m.houseId, id), m);
  }

  async create(m: HouseMembership, dto: CreateExpenseDto, now = new Date()): Promise<ExpenseDto> {
    const active = await this.activeMemberIds(m.houseId);
    const payerId = dto.payerId ?? m.userId;
    this.assertAllowed([payerId], active, 'Người trả phải là thành viên của nhà.');
    if (dto.splitType === 'ITEMIZED' && dto.items) assertItemizedItems(dto.items);
    const shares = this.split(
      {
        splitType: dto.splitType,
        total: dto.totalAmount,
        participantIds: dto.participantIds,
        splits: dto.splits,
        items: dto.splitType === 'ITEMIZED' ? splitItems(dto.items) : undefined,
      },
      active,
      new Set(active),
    );
    if (dto.receiptImageUrl) this.assertReceiptUrl(m.houseId, dto.receiptImageUrl);
    // Bản nháp OCR: kiểm tra trước để trả 404/409 sớm; việc đánh dấu USED nằm trong transaction bên dưới.
    const scan = dto.receiptScanId ? await this.loadScan(m.houseId, dto.receiptScanId) : null;
    const storedItems = itemsForStorage(dto.items, dto.splitType);

    const created = await this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          houseId: m.houseId,
          payerId,
          createdById: m.userId,
          title: dto.title,
          category: dto.category,
          totalAmount: dto.totalAmount,
          splitType: dto.splitType,
          spentAt: this.spentAt(dto.spentAt, now),
          note: dto.note || null,
          // Không gửi ảnh thì lấy ảnh của bản nháp OCR; gửi null tường minh thì không gắn ảnh.
          receiptImageUrl: dto.receiptImageUrl === undefined ? (scan?.imageUrl ?? null) : dto.receiptImageUrl,
          items: storedItems.length ? storedItems : undefined,
          splits: { create: shares.map((s) => ({ userId: s.userId, allocatedAmount: s.amount })) },
        },
        include: EXPENSE_INCLUDE,
      });
      if (scan) {
        // Chỉ một request thắng: request thứ hai chờ khóa dòng, thấy status đã USED, count = 0 và hủy cả transaction.
        const linked = await tx.receiptScan.updateMany({
          where: { id: scan.id, status: { not: 'USED' } },
          data: { status: 'USED', expenseId: expense.id },
        });
        if (linked.count !== 1) throw scanUsed();
      }
      return expense;
    });

    this.events.emitToHouse(m.houseId, 'expense:new', {
      expenseId: created.id,
      title: created.title,
      payer: { id: created.payer.id, fullName: created.payer.fullName },
      amount: created.totalAmount,
      fromReceipt: scan !== null,
    });
    return this.toDto(created, m);
  }

  async update(m: HouseMembership, id: string, dto: UpdateExpenseDto, now = new Date()): Promise<ExpenseDto> {
    const old = await this.load(m.houseId, id);
    this.assertCanEdit(old, m);

    const active = await this.activeMemberIds(m.houseId);
    // Người đã rời nhà nhưng vốn có trong khoản chi này vẫn được giữ khi sửa.
    const allowed = new Set([...active, old.payerId, ...old.splits.map((s) => s.userId)]);
    const payerId = dto.payerId ?? old.payerId;
    this.assertAllowed([payerId], allowed, 'Người trả phải là thành viên của nhà.');

    const total = dto.totalAmount ?? old.totalAmount;
    const splitType = dto.splitType ?? old.splitType;
    const itemized = splitType === 'ITEMIZED';
    if (itemized && dto.items !== undefined) assertItemizedItems(dto.items);
    // Với kiểu chia khác, items chỉ để xem lại nên không kéo theo chia lại.
    const resplit =
      dto.totalAmount !== undefined ||
      dto.splitType !== undefined ||
      dto.participantIds !== undefined ||
      dto.splits !== undefined ||
      (dto.items !== undefined && itemized);
    let shares: SplitShare[] | undefined;
    if (resplit) {
      const sameType = splitType === old.splitType;
      shares = this.split(
        {
          splitType,
          total,
          items: itemized ? splitItems(dto.items) : undefined,
          participantIds: dto.participantIds ?? (sameType && splitType === 'CUSTOM' ? old.splits.map((s) => s.userId) : undefined),
          splits:
            dto.splits ??
            (sameType && splitType === 'EXACT' && total === old.totalAmount
              ? old.splits.map((s) => ({ userId: s.userId, amount: s.allocatedAmount }))
              : undefined),
        },
        active,
        allowed,
      );
    }

    // items: gửi thì thay (rỗng = xóa); không gửi thì giữ, trừ khi đổi khỏi ITEMIZED (xóa người dùng món).
    let nextItems: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
    if (dto.items !== undefined) {
      const stored = itemsForStorage(dto.items, splitType);
      nextItems = stored.length ? stored : Prisma.DbNull;
    } else if (old.splitType === 'ITEMIZED' && !itemized) {
      const cleared = clearAssignees(parseStoredItems(old.items));
      nextItems = cleared.length ? cleared : Prisma.DbNull;
    }

    const receiptChanged = dto.receiptImageUrl !== undefined && dto.receiptImageUrl !== old.receiptImageUrl;
    if (receiptChanged && dto.receiptImageUrl) this.assertReceiptUrl(m.houseId, dto.receiptImageUrl);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (shares) await tx.expenseSplit.deleteMany({ where: { expenseId: id } });
      return tx.expense.update({
        where: { id },
        data: {
          payerId,
          title: dto.title,
          category: dto.category,
          totalAmount: total,
          splitType,
          spentAt: dto.spentAt !== undefined ? this.spentAt(dto.spentAt, now) : undefined,
          note: dto.note !== undefined ? dto.note || null : undefined,
          receiptImageUrl: receiptChanged ? dto.receiptImageUrl : undefined,
          items: nextItems,
          ...(shares ? { splits: { create: shares.map((s) => ({ userId: s.userId, allocatedAmount: s.amount })) } } : {}),
        },
        include: EXPENSE_INCLUDE,
      });
    });

    if (receiptChanged && old.receiptImageUrl) await this.destroyImage(old.receiptImageUrl);
    this.events.emitToHouse(m.houseId, 'expense:updated', { expenseId: id });
    return this.toDto(updated, m);
  }

  async remove(m: HouseMembership, id: string): Promise<{ ok: true }> {
    const old = await this.load(m.houseId, id);
    this.assertCanEdit(old, m);
    await this.prisma.expense.delete({ where: { id } });
    if (old.receiptImageUrl) await this.destroyImage(old.receiptImageUrl);
    this.events.emitToHouse(m.houseId, 'expense:deleted', { expenseId: id });
    return { ok: true };
  }

  /** Ảnh hóa đơn tải lên trước, trả URL để gắn vào khoản chi khi tạo/sửa. */
  async uploadReceipt(m: HouseMembership, file: UploadedImage | undefined): Promise<UploadedUrlDto> {
    validateImageFile(file);
    const { url } = await this.cloudinary.upload(file.buffer, `houses/${m.houseId}/receipts`);
    return { url };
  }

  /** Bản nháp OCR của đúng nhà này và chưa dùng; sai nhà cũng báo 404 để không lộ bản nháp của nhà khác. */
  private async loadScan(houseId: string, id: string) {
    const scan = await this.prisma.receiptScan.findFirst({ where: { id, houseId } });
    if (!scan) throw coded(HttpStatus.NOT_FOUND, 'RECEIPT_SCAN_NOT_FOUND', 'Không tìm thấy bản nháp hóa đơn này.');
    if (scan.status === 'USED') throw scanUsed();
    return scan;
  }

  private async load(houseId: string, id: string): Promise<ExpenseRow> {
    const row = await this.prisma.expense.findFirst({ where: { id, houseId }, include: EXPENSE_INCLUDE });
    if (!row) throw coded(HttpStatus.NOT_FOUND, 'EXPENSE_NOT_FOUND', 'Không tìm thấy khoản chi.');
    return row;
  }

  /** Thành viên còn ở, theo thứ tự vào nhà: thứ tự này quyết định ai nhận 1đ dư khi chia đều. */
  private async activeMemberIds(houseId: string): Promise<string[]> {
    const members = await this.prisma.houseMember.findMany({
      where: { houseId, leftAt: null },
      select: { userId: true },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    });
    return members.map((x) => x.userId);
  }

  private assertAllowed(userIds: readonly string[], allowed: ReadonlySet<string> | readonly string[], message: string) {
    const set = allowed instanceof Set ? allowed : new Set(allowed);
    if (userIds.some((u) => !set.has(u))) throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'NOT_A_HOUSE_MEMBER', message);
  }

  /**
   * EQUAL chia cho mọi thành viên đang ở; CUSTOM chia đều cho người được chọn (sắp theo thứ tự vào nhà);
   * EXACT lấy số tiền từng người; ITEMIZED chia theo từng món (phần chênh chia theo tỷ lệ). Phần 0đ không lưu.
   */
  private split(req: SplitRequest, active: readonly string[], allowed: ReadonlySet<string>): SplitShare[] {
    if (req.splitType !== 'CUSTOM' && req.participantIds !== undefined) {
      throw splitInvalid('Chỉ kiểu "Chọn người" mới nhận danh sách người hưởng.');
    }
    if (req.splitType !== 'EXACT' && req.splits !== undefined) {
      throw splitInvalid('Chỉ kiểu "Chính xác" mới nhận số tiền từng người.');
    }

    let shares: SplitShare[];
    switch (req.splitType) {
      case 'EQUAL':
        shares = computeSplit({ type: 'EQUAL', total: req.total, userIds: active });
        break;
      case 'CUSTOM': {
        if (!req.participantIds?.length) throw splitInvalid('Chọn ít nhất một người cùng chịu khoản chi.');
        this.assertAllowed(req.participantIds, allowed, 'Người được chọn phải là thành viên của nhà.');
        const order = (u: string) => {
          const i = active.indexOf(u);
          return i === -1 ? active.length : i;
        };
        const userIds = [...req.participantIds].sort((a, b) => order(a) - order(b));
        shares = computeSplit({ type: 'CUSTOM', total: req.total, userIds });
        break;
      }
      case 'EXACT':
        if (!req.splits?.length) throw splitInvalid('Nhập số tiền cho từng người.');
        this.assertAllowed(req.splits.map((s) => s.userId), allowed, 'Người chịu phần phải là thành viên của nhà.');
        shares = computeSplit({ type: 'EXACT', total: req.total, amounts: req.splits });
        break;
      case 'ITEMIZED':
        if (!req.items?.length) throw splitInvalid('Nhập danh sách món để chia theo món.');
        this.assertAllowed(req.items.flatMap((i) => i.userIds), allowed, 'Người dùng món phải là thành viên của nhà.');
        shares = computeSplit({ type: 'ITEMIZED', total: req.total, items: req.items, order: active });
        break;
    }
    return shares.filter((s) => s.amount > 0);
  }

  private spentAt(value: string | undefined, now: Date): Date {
    if (value === undefined) return now;
    const date = new Date(value);
    if (date.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
      throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'SPENT_AT_IN_FUTURE', 'Ngày chi không được ở tương lai.');
    }
    return date;
  }

  /** Chỉ nhận ảnh đã tải lên qua API của chính nhà này (không gắn link ngoài). */
  private assertReceiptUrl(houseId: string, url: string) {
    if (!publicIdFromUrl(url)?.startsWith(`nestfair/houses/${houseId}/receipts/`)) {
      throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'RECEIPT_URL_INVALID', 'Ảnh hóa đơn phải được tải lên qua NestFair.');
    }
  }

  private async destroyImage(url: string) {
    const publicId = publicIdFromUrl(url);
    if (publicId) await this.cloudinary.destroy(publicId);
  }

  private assertCanEdit(e: { payerId: string; createdById: string }, m: HouseMembership) {
    if (!this.canEdit(e, m)) {
      throw coded(HttpStatus.FORBIDDEN, 'EXPENSE_FORBIDDEN', 'Chỉ người trả, người ghi hoặc trưởng phòng mới sửa/xóa được khoản chi này.');
    }
  }

  private canEdit(e: { payerId: string; createdById: string }, m: HouseMembership) {
    return e.payerId === m.userId || e.createdById === m.userId || m.role === 'ADMIN';
  }

  private toDto(e: ExpenseRow, m: HouseMembership): ExpenseDto {
    return {
      id: e.id,
      title: e.title,
      category: e.category,
      totalAmount: e.totalAmount,
      splitType: e.splitType,
      spentAt: e.spentAt,
      note: e.note,
      receiptImageUrl: e.receiptImageUrl,
      payer: e.payer,
      createdById: e.createdById,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      splits: e.splits.map((s) => ({ userId: s.userId, fullName: s.user.fullName, avatarUrl: s.user.avatarUrl, amount: s.allocatedAmount })),
      items: parseStoredItems(e.items),
      myShare: e.splits.find((s) => s.userId === m.userId)?.allocatedAmount ?? 0,
      canEdit: this.canEdit(e, m),
    };
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { monthRange } from '../expenses/month.js';
import { LedgerService } from '../expenses/ledger.service.js';
import type { HouseMembership } from '../houses/guards/house-member.guard.js';
import { CloudinaryService, publicIdFromUrl } from '../uploads/cloudinary.service.js';
import { type UploadedImage, validateImageFile } from '../uploads/image-validation.js';
import type { UploadedUrlDto } from '../expenses/dto/expense-response.dto.js';
import type { CreateSettlementDto, ListSettlementsQuery, SettlementDto } from './dto/settlement.dto.js';

const USER_BRIEF = { select: { id: true, fullName: true, avatarUrl: true } } as const;
const SETTLEMENT_INCLUDE = { from: USER_BRIEF, to: USER_BRIEF } satisfies Prisma.SettlementInclude;
type SettlementRow = Prisma.SettlementGetPayload<{ include: typeof SETTLEMENT_INCLUDE }>;

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const alreadyPending = () =>
  coded(HttpStatus.CONFLICT, 'SETTLEMENT_ALREADY_PENDING', 'Bạn đã báo chuyển cho người này, hãy chờ xác nhận hoặc hủy báo cũ.');
const fmt = (amount: number) => `${amount.toLocaleString('vi-VN')}đ`;

@Injectable()
export class SettlementActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly cloudinary: CloudinaryService,
    private readonly events: EventsService,
  ) {}

  /** Lịch sử tất toán, mới nhất trước. Không truyền `month` thì lấy toàn bộ. */
  async list(m: HouseMembership, query: ListSettlementsQuery): Promise<SettlementDto[]> {
    const range = query.month ? monthRange(query.month) : undefined;
    const rows = await this.prisma.settlement.findMany({
      where: {
        houseId: m.houseId,
        ...(range ? { createdAt: { gte: range.start, lt: range.end } } : {}),
        ...(query.scope === 'mine' ? { OR: [{ fromUserId: m.userId }, { toUserId: m.userId }] } : {}),
      },
      include: SETTLEMENT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  /**
   * Người nợ báo "Tôi đã chuyển": tạo settlement PENDING (chưa tính vào số dư cho tới khi người nhận xác nhận).
   * Số tiền không được vượt số bạn còn nợ và số người nhận còn được nhận, đã trừ các báo chuyển đang chờ,
   * để không thể báo trả thừa. Khóa advisory theo nhà để hai báo chuyển song song không cùng vượt hạn mức.
   */
  async create(m: HouseMembership, dto: CreateSettlementDto): Promise<SettlementDto> {
    if (dto.toUserId === m.userId) {
      throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'SETTLEMENT_SELF', 'Không thể chuyển tiền cho chính mình.');
    }
    if (dto.proofUrl && !publicIdFromUrl(dto.proofUrl)?.startsWith(`nestfair/houses/${m.houseId}/settlements/`)) {
      throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'PROOF_URL_INVALID', 'Ảnh bill phải được tải lên qua NestFair.');
    }

    let created: SettlementRow;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`settlement:${m.houseId}`}::text))::text`;

        const receiver = await tx.houseMember.findFirst({ where: { houseId: m.houseId, userId: dto.toUserId }, select: { id: true } });
        if (!receiver) throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'NOT_A_HOUSE_MEMBER', 'Người nhận phải là thành viên của nhà.');

        const [net, pending] = await Promise.all([
          this.ledger.netBalances(m.houseId, tx),
          tx.settlement.findMany({ where: { houseId: m.houseId, status: 'PENDING' }, select: { fromUserId: true, toUserId: true, amount: true } }),
        ]);
        if (pending.some((p) => p.fromUserId === m.userId && p.toUserId === dto.toUserId)) throw alreadyPending();

        const pendingFrom = pending.filter((p) => p.fromUserId === m.userId).reduce((s, p) => s + p.amount, 0);
        const pendingTo = pending.filter((p) => p.toUserId === dto.toUserId).reduce((s, p) => s + p.amount, 0);
        const canPay = -(net.get(m.userId) ?? 0) - pendingFrom;
        const canReceive = (net.get(dto.toUserId) ?? 0) - pendingTo;
        const limit = Math.min(canPay, canReceive);
        if (limit <= 0) {
          throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'SETTLEMENT_AMOUNT_EXCEEDS_DEBT', 'Bạn không còn nợ người này khoản nào cần trả.');
        }
        if (dto.amount > limit) {
          throw coded(HttpStatus.UNPROCESSABLE_ENTITY, 'SETTLEMENT_AMOUNT_EXCEEDS_DEBT', `Số tiền tối đa có thể trả cho người này là ${fmt(limit)}.`);
        }

        return tx.settlement.create({
          data: {
            houseId: m.houseId,
            fromUserId: m.userId,
            toUserId: dto.toUserId,
            amount: dto.amount,
            proofUrl: dto.proofUrl ?? null,
            note: dto.note || null,
          },
          include: SETTLEMENT_INCLUDE,
        });
      });
    } catch (error) {
      // Lưới an toàn cuối: partial unique index (houseId, fromUserId, toUserId) WHERE status = 'PENDING'.
      if (isUniqueViolation(error)) throw alreadyPending();
      throw error;
    }

    this.events.emitToHouse(m.houseId, 'settlement:requested', {
      settlementId: created.id,
      fromUserId: created.fromUserId,
      toUserId: created.toUserId,
      amount: created.amount,
    });
    return toDto(created);
  }

  /**
   * Người nhận bấm "Xác nhận đã nhận tiền": PENDING → CONFIRMED, từ đó settlement được tính vào số dư.
   * Một câu UPDATE có điều kiện `status = 'PENDING'` nên bấm đúp hay hai yêu cầu song song chỉ một lần thành công,
   * lần sau nhận 409. Không kiểm tra lại số tiền với số dư hiện tại: tiền đã thật sự chuyển thì ghi nhận đúng
   * như vậy (nếu khoản chi bị sửa sau đó, số dư tự đảo chiều chứ không mất tiền).
   */
  async confirm(m: HouseMembership, id: string, now = new Date()): Promise<SettlementDto> {
    const { count } = await this.prisma.settlement.updateMany({
      where: { id, houseId: m.houseId, toUserId: m.userId, status: 'PENDING' },
      data: { status: 'CONFIRMED', confirmedAt: now },
    });
    if (count === 0) await this.explainNoop(m, id, 'confirm');

    const row = await this.prisma.settlement.findUniqueOrThrow({ where: { id }, include: SETTLEMENT_INCLUDE });
    this.events.emitToHouse(m.houseId, 'debt:settled', {
      settlementId: row.id,
      fromUserId: row.fromUserId,
      toUserId: row.toUserId,
      amount: row.amount,
    });
    return toDto(row);
  }

  /** Người chuyển rút lại báo, hoặc người nhận báo "chưa nhận được": PENDING → CANCELLED. */
  async cancel(m: HouseMembership, id: string): Promise<SettlementDto> {
    const { count } = await this.prisma.settlement.updateMany({
      where: { id, houseId: m.houseId, status: 'PENDING', OR: [{ fromUserId: m.userId }, { toUserId: m.userId }] },
      data: { status: 'CANCELLED' },
    });
    if (count === 0) await this.explainNoop(m, id, 'cancel');

    const row = await this.prisma.settlement.findUniqueOrThrow({ where: { id }, include: SETTLEMENT_INCLUDE });
    this.events.emitToHouse(m.houseId, 'settlement:cancelled', { settlementId: row.id, fromUserId: row.fromUserId, toUserId: row.toUserId });
    return toDto(row);
  }

  /** Ảnh bill chuyển khoản tải lên trước, trả URL để gửi kèm khi báo đã chuyển. */
  async uploadProof(m: HouseMembership, file: UploadedImage | undefined): Promise<UploadedUrlDto> {
    validateImageFile(file);
    const { url } = await this.cloudinary.upload(file.buffer, `houses/${m.houseId}/settlements`);
    return { url };
  }

  /** UPDATE có điều kiện không đổi dòng nào: tìm lý do để trả đúng mã lỗi. Luôn ném. */
  private async explainNoop(m: HouseMembership, id: string, action: 'confirm' | 'cancel'): Promise<never> {
    const row = await this.prisma.settlement.findFirst({ where: { id, houseId: m.houseId } });
    if (!row) throw coded(HttpStatus.NOT_FOUND, 'SETTLEMENT_NOT_FOUND', 'Không tìm thấy giao dịch này.');
    if (action === 'confirm' && row.toUserId !== m.userId) {
      throw coded(HttpStatus.FORBIDDEN, 'NOT_SETTLEMENT_RECEIVER', 'Chỉ người nhận tiền mới xác nhận được.');
    }
    if (action === 'cancel' && row.toUserId !== m.userId && row.fromUserId !== m.userId) {
      throw coded(HttpStatus.FORBIDDEN, 'NOT_SETTLEMENT_PARTY', 'Chỉ người chuyển hoặc người nhận mới hủy được.');
    }
    throw coded(
      HttpStatus.CONFLICT,
      'SETTLEMENT_NOT_PENDING',
      row.status === 'CONFIRMED' ? 'Giao dịch này đã được xác nhận.' : 'Giao dịch này đã bị hủy.',
    );
  }
}

function toDto(s: SettlementRow): SettlementDto {
  return {
    id: s.id,
    from: s.from,
    to: s.to,
    amount: s.amount,
    status: s.status,
    proofUrl: s.proofUrl,
    note: s.note,
    createdAt: s.createdAt,
    confirmedAt: s.confirmedAt,
  };
}

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { actorOfUser } from '../events/actor.js';
import { EventsService, type Outbox } from '../events/events.service.js';
import { LedgerService } from '../expenses/ledger.service.js';
import type { HouseMembership } from '../houses/guards/house-member.guard.js';
import { SwapLifecycleService } from '../swaps/swap-lifecycle.service.js';
import { CloudinaryService } from '../uploads/cloudinary.service.js';
import { houseImagePublicIds } from './algorithms/house-images.js';
import type { DissolveHouseDto, DissolveHouseResultDto } from './dto/membership.dto.js';

type Tx = Prisma.TransactionClient;

/** Xóa ảnh theo từng đợt nhỏ để không bắn hàng trăm request Cloudinary cùng lúc. */
const DESTROY_BATCH = 5;

/**
 * Giải tán nhà (trưởng phòng). Giải tán MỀM: không xóa cascade, chỉ đánh `dissolvedAt`, cho mọi người rời
 * (`leftAt`) và đóng các việc còn dở. Dữ liệu cũ vẫn nằm trong DB nhưng không ai truy cập được nữa, còn ảnh
 * trên Cloudinary thì được dọn (phần duy nhất tốn dung lượng thật).
 */
@Injectable()
export class DissolveService {
  private readonly logger = new Logger(DissolveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly swaps: SwapLifecycleService,
    private readonly events: EventsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async dissolve(m: HouseMembership, dto: DissolveHouseDto, now: Date = new Date()): Promise<DissolveHouseResultDto> {
    const actor = await actorOfUser(this.prisma, m.userId);
    const outbox = this.events.outbox();
    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM houses WHERE id = ${m.houseId}::uuid FOR UPDATE`;
      const house = await tx.house.findUniqueOrThrow({ where: { id: m.houseId }, select: { name: true, dissolvedAt: true } });
      if (house.dissolvedAt) throw coded(HttpStatus.CONFLICT, 'ALREADY_DISSOLVED', 'Nhà này đã được giải tán rồi.');
      if (dto.confirmName.trim() !== house.name.trim()) {
        throw coded(HttpStatus.BAD_REQUEST, 'CONFIRM_NAME_MISMATCH', 'Tên nhà bạn nhập chưa khớp. Gõ đúng tên nhà để xác nhận giải tán.');
      }

      // Còn nợ thì chưa giải tán được: cùng nguyên tắc với rời nhà, không để ai mất tiền ngoài ý muốn.
      const net = await this.ledger.netBalances(m.houseId, tx);
      const withBalance = [...net.values()].filter((v) => v !== 0).length;
      if (withBalance > 0) {
        throw coded(HttpStatus.CONFLICT, 'HAS_BALANCE', 'Cả nhà cần thanh toán hết các khoản nợ rồi mới giải tán được.', { membersWithBalance: withBalance });
      }

      const members = await tx.houseMember.findMany({ where: { houseId: m.houseId, leftAt: null }, select: { userId: true } });
      const imageIds = await this.closeEverything(tx, outbox, m.houseId, now);
      await tx.houseMember.updateMany({ where: { houseId: m.houseId, leftAt: null }, data: { leftAt: now } });
      // Mã mời hết hiệu lực ngay; `join` cũng chặn theo `dissolvedAt`.
      await tx.house.update({ where: { id: m.houseId }, data: { dissolvedAt: now, inviteExpiresAt: now } });
      return { name: house.name, userIds: members.map((x) => x.userId), imageIds };
    });

    // Sau commit: báo mọi người, rồi dọn ảnh (lỗi chỉ ghi log, không làm hỏng việc giải tán).
    await this.events.dissolveHouse(m.houseId, done.userIds, done.name);
    outbox.flush();
    await this.destroyImages(done.imageIds);
    this.logger.log(`Nhà ${m.houseId} đã giải tán bởi ${actor.name}: ${done.userIds.length} thành viên, ${done.imageIds.length} ảnh đã dọn.`);
    return { houseId: m.houseId, members: done.userIds.length, imagesRemoved: done.imageIds.length };
  }

  /** Đóng việc còn dở của nhà và trả về `public_id` các ảnh cần dọn. */
  private async closeEverything(tx: Tx, outbox: Outbox, houseId: string, now: Date): Promise<string[]> {
    await tx.settlement.updateMany({ where: { houseId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await this.swaps.cancelAllPendingInHouse(tx, outbox, houseId, 'MEMBER_LEFT');
    await tx.choreDebt.updateMany({
      where: { houseId, status: 'OPEN' },
      data: { status: 'CANCELLED', closeReason: 'HOUSE_DISSOLVED', settledAt: now },
    });
    await tx.choreAssignment.updateMany({
      where: { houseId, status: { in: ['TODO', 'UNASSIGNED'] }, dueAt: { gt: now } },
      data: { status: 'CANCELLED', version: { increment: 1 } },
    });
    await tx.reminder.deleteMany({ where: { houseId, sentAt: null } });

    const listing = await tx.roomListing.findUnique({ where: { houseId }, select: { id: true, status: true } });
    let listingUrls: string[] = [];
    if (listing) {
      listingUrls = (await tx.listingPhoto.findMany({ where: { listingId: listing.id }, select: { url: true } })).map((p) => p.url);
      await tx.listingPhoto.deleteMany({ where: { listingId: listing.id } });
      if (listing.status !== 'CLOSED') {
        await tx.roomListing.update({ where: { id: listing.id }, data: { status: 'CLOSED', closeReason: 'MANUAL', closedAt: now } });
      }
    }

    const [proofs, receipts, settlementProofs, scans] = await Promise.all([
      tx.choreAssignment.findMany({ where: { houseId, proofImageUrl: { not: null } }, select: { proofImageUrl: true } }),
      tx.expense.findMany({ where: { houseId, receiptImageUrl: { not: null } }, select: { receiptImageUrl: true } }),
      tx.settlement.findMany({ where: { houseId, proofUrl: { not: null } }, select: { proofUrl: true } }),
      tx.receiptScan.findMany({ where: { houseId }, select: { imageUrl: true } }),
    ]);
    return houseImagePublicIds([
      listingUrls,
      proofs.map((x) => x.proofImageUrl),
      receipts.map((x) => x.receiptImageUrl),
      settlementProofs.map((x) => x.proofUrl),
      scans.map((x) => x.imageUrl),
    ]);
  }

  private async destroyImages(publicIds: string[]): Promise<void> {
    for (let i = 0; i < publicIds.length; i += DESTROY_BATCH) {
      // `destroy` tự nuốt lỗi và ghi log nên một ảnh hỏng không chặn các ảnh còn lại.
      await Promise.all(publicIds.slice(i, i + DESTROY_BATCH).map((id) => this.cloudinary.destroy(id)));
    }
  }
}

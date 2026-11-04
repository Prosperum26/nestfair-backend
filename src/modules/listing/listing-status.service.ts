import { HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { ListingStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { missingPhotos, nextStatus } from './algorithms/status.js';
import type { ListingPayloadDto } from './dto/listing-response.dto.js';
import { ListingService } from './listing.service.js';

type Outcome =
  | { kind: 'not-found' }
  | { kind: 'error'; error: 'HOUSE_FULL' | 'LISTING_INCOMPLETE' | 'LISTING_STATUS_INVALID'; missing: string[] }
  | { kind: 'done'; closedListingId: string | null };

@Injectable()
export class ListingStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listing: ListingService,
    private readonly events: EventsService,
  ) {}

  /**
   * Đổi trạng thái tin (máy trạng thái ở `nextStatus`). Khóa dòng `houses` (FOR UPDATE, cùng khóa với `join`)
   * rồi mới đếm thành viên và đọc ảnh, để không chạy đua với người vào nhà hay xóa ảnh.
   * Lỗi nghiệp vụ được trả ra khỏi transaction rồi mới ném; event phát SAU khi commit.
   */
  async setStatus(
    houseId: string,
    actor: { userId: string },
    target: ListingStatus,
    now: Date = new Date(),
  ): Promise<ListingPayloadDto> {
    const outcome = await this.prisma.$transaction(async (tx): Promise<Outcome> => {
      const [house] = await tx.$queryRaw<{ maxMembers: number }[]>`
        SELECT "maxMembers" FROM houses WHERE id = ${houseId}::uuid FOR UPDATE`;
      const listing = await tx.roomListing.findUnique({
        where: { houseId },
        include: { photos: { select: { category: true } } },
      });
      if (!house || !listing) return { kind: 'not-found' };

      const memberCount = await tx.houseMember.count({ where: { houseId, leftAt: null } });
      const missing = missingPhotos(listing.photos);
      const decision = nextStatus({
        current: listing.status,
        target,
        slotsOpen: Math.max(0, house.maxMembers - memberCount),
        missing,
      });

      if ('error' in decision) return { kind: 'error', error: decision.error, missing };
      if (!decision.change) return { kind: 'done', closedListingId: null };

      await tx.roomListing.update({
        where: { id: listing.id },
        data: {
          status: decision.status,
          closeReason: decision.closeReason,
          closedAt: decision.setClosedAt ? now : null,
          ...(decision.setPublishedAt && !listing.publishedAt ? { publishedAt: now } : {}),
        },
      });
      return { kind: 'done', closedListingId: decision.status === 'CLOSED' ? listing.id : null };
    });

    if (outcome.kind === 'not-found') {
      throw coded(HttpStatus.NOT_FOUND, 'LISTING_NOT_FOUND', 'Nhà chưa có tin đăng. Hãy lưu nội dung tin trước.');
    }
    if (outcome.kind === 'error') throw this.toException(outcome.error, outcome.missing);

    if (outcome.closedListingId) {
      this.events.emitToHouse(houseId, 'listing:closed', { listingId: outcome.closedListingId, reason: 'MANUAL' });
    }
    return this.listing.getForHouse(houseId, actor.userId, now);
  }

  private toException(error: Extract<Outcome, { kind: 'error' }>['error'], missing: string[]) {
    switch (error) {
      case 'HOUSE_FULL':
        return coded(
          HttpStatus.CONFLICT,
          'HOUSE_FULL',
          'Nhà đã đủ người nên chưa thể đăng tin. Hãy tăng số người tối đa hoặc chờ có người rời đi.',
        );
      case 'LISTING_INCOMPLETE':
        return coded(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'LISTING_INCOMPLETE',
          'Tin cần ít nhất 1 ảnh mỗi nhóm: Phòng ngủ, WC và Sinh hoạt.',
          { missing },
        );
      case 'LISTING_STATUS_INVALID':
        return coded(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'LISTING_STATUS_INVALID',
          'Tin đã đóng không quay về bản nháp được. Hãy mở lại tin hoặc giữ nguyên.',
        );
    }
  }
}

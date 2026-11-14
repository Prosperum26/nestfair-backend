import { HttpStatus, Injectable } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { currentWeekStart, weekKeyFromStart } from '../chores/week.js';
import { dateOf, dsOf } from '../chores/schedule-context.js';
import { isValidSlug } from './algorithms/slug.js';
import { buildRoster, type PublicRoster } from './algorithms/roster.js';
import type { PublicListingDto } from './dto/public-listing.dto.js';
import { toPublicListing } from './public-listing.mapper.js';
import { ListingSummaryService } from './listing-summary.service.js';

const NOT_FOUND = 'Tin này không còn hoặc đường dẫn chưa đúng.';

/**
 * Trang công khai `/r/:slug`. Chỉ đọc: không gọi `ScheduleService` hay `ensureSchedule`, không ghi gì.
 * Mọi trường trả ra đi qua `toPublicListing` (chọn từng trường bằng tay).
 */
@Injectable()
export class PublicListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: ListingSummaryService,
  ) {}

  async get(slug: string, now: Date = new Date()): Promise<PublicListingDto> {
    // Slug sai định dạng trả 404 cùng mã, không chạm DB.
    if (!isValidSlug(slug)) throw this.notFound();

    const listing = await this.prisma.roomListing.findUnique({
      where: { slug },
      include: { photos: true },
    });
    // DRAFT (tạm ẩn) coi như không tồn tại.
    if (!listing || listing.status === 'DRAFT') throw this.notFound();

    // Tin đã đóng chỉ cần bản rút gọn, khỏi đọc số liệu và lịch.
    const summary = listing.status === 'OPEN' ? await this.summaries.summary(listing.houseId, now) : null;
    const showRoster = listing.status === 'OPEN' && summary !== null && summary.slotsOpen > 0 && listing.showChoreSchedule;
    const roster = showRoster ? await this.loadRoster(listing.id, listing.houseId, now) : null;

    return toPublicListing({ listing, photos: listing.photos, summary, roster });
  }

  /** Ca của tuần hiện tại đọc trực tiếp từ DB; chưa có lịch thì `null` (không sinh lịch). */
  private async loadRoster(listingId: string, houseId: string, now: Date): Promise<PublicRoster | null> {
    const weekStart = currentWeekStart(now);
    const [members, assignments] = await Promise.all([
      this.prisma.houseMember.findMany({ where: { houseId, leftAt: null }, select: { id: true } }),
      this.prisma.choreAssignment.findMany({
        where: { houseId, weekStart: dateOf(weekStart) },
        select: {
          choreId: true,
          titleSnapshot: true,
          occurrenceDate: true,
          slotIndex: true,
          assigneeId: true,
          status: true,
          source: true,
        },
      }),
    ]);

    return buildRoster({
      listingId,
      weekKey: weekKeyFromStart(weekStart),
      weekStart,
      activeMemberIds: members.map((m) => m.id),
      slots: assignments.map((a) => ({
        choreId: a.choreId,
        title: a.titleSnapshot,
        occurrenceDate: dsOf(a.occurrenceDate),
        slotIndex: a.slotIndex,
        assigneeId: a.assigneeId,
        status: a.status,
        source: a.source,
      })),
    });
  }

  private notFound() {
    return coded(HttpStatus.NOT_FOUND, 'LISTING_NOT_FOUND', NOT_FOUND);
  }
}

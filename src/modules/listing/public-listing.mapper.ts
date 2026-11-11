import type {
  GenderWanted,
  ListingCloseReason,
  ListingPhotoCategory,
  ListingStatus,
} from '../../generated/prisma/enums.js';
import { estimateTotal } from './algorithms/pricing.js';
import type { PublicRoster } from './algorithms/roster.js';
import type { ListingSummary } from './listing-summary.service.js';
import type {
  PublicListingClosedDto,
  PublicListingDto,
  PublicListingOpenDto,
  PublicPhotoDto,
} from './dto/public-listing.dto.js';

/** Các trường của dòng `RoomListing` mà mapper đọc; dòng Prisma có nhiều trường hơn nhưng không được lọt ra. */
export interface PublicListingSource {
  slug: string;
  status: ListingStatus;
  closeReason: ListingCloseReason | null;
  publishedAt: Date | null;
  locationText: string;
  mapUrl: string | null;
  genderWanted: GenderWanted;
  rentPerMonth: number;
  otherFees: unknown;
  description: string;
  roommateExpectations: string;
  contactPhone: string;
}

export interface PublicListingInput {
  listing: PublicListingSource;
  photos: { id: string; category: ListingPhotoCategory; url: string; sortOrder: number }[];
  /** `null` được phép khi tin đã `CLOSED` (không cần số liệu). */
  summary: ListingSummary | null;
  roster: PublicRoster | null;
}

const CATEGORIES: ListingPhotoCategory[] = ['BEDROOM', 'BATHROOM', 'LIVING'];

/**
 * Chuyển dòng DB thành payload công khai (L7, L8). **Chọn từng trường bằng tay**, không spread dòng Prisma,
 * để cột thêm sau này không vô tình lộ ra. Tin đã đóng hoặc nhà đã đủ người chỉ trả bản rút gọn, không có liên hệ.
 */
export function toPublicListing(input: PublicListingInput): PublicListingDto {
  const { listing, summary } = input;
  if (listing.status === 'DRAFT') throw new Error('Tin nháp không được đưa ra công khai.');

  const sorted = [...input.photos].sort((a, b) => a.sortOrder - b.sortOrder);
  const full = listing.status === 'OPEN' && summary !== null && summary.slotsOpen <= 0;

  if (listing.status === 'CLOSED' || full || summary === null) {
    const cover = sorted.find((p) => p.category === 'BEDROOM');
    const closed: PublicListingClosedDto = {
      slug: listing.slug,
      status: 'CLOSED',
      closeReason: listing.closeReason ?? 'FULL',
      locationText: listing.locationText,
      coverUrl: cover ? cover.url : null,
    };
    return closed;
  }

  const otherFees = (listing.otherFees as { name: string; amount: number }[]).map((fee) => ({
    name: fee.name,
    amount: fee.amount,
  }));
  const photos = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      sorted.filter((p) => p.category === category).map((p): PublicPhotoDto => ({ id: p.id, url: p.url })),
    ]),
  ) as unknown as PublicListingOpenDto['photos'];

  return {
    slug: listing.slug,
    status: 'OPEN',
    closeReason: null,
    publishedAt: listing.publishedAt,
    locationText: listing.locationText,
    mapUrl: listing.mapUrl,
    genderWanted: listing.genderWanted,
    rentPerMonth: listing.rentPerMonth,
    otherFees,
    summary: {
      memberCount: summary.memberCount,
      maxMembers: summary.maxMembers,
      slotsOpen: summary.slotsOpen,
      utilities: {
        avgMonthlyTotal: summary.utilities.avgMonthlyTotal,
        perPerson: summary.utilities.perPerson,
        monthsUsed: summary.utilities.monthsUsed,
      },
    },
    estimatedPerPerson: estimateTotal({
      rentPerMonth: listing.rentPerMonth,
      utilitiesPerPerson: summary.utilities.perPerson,
      otherFees,
    }),
    description: listing.description,
    roommateExpectations: listing.roommateExpectations,
    photos,
    roster: input.roster
      ? { weekKey: input.roster.weekKey, rows: input.roster.rows.map((r) => ({ title: r.title, cells: r.cells })) }
      : null,
    contact: { phone: listing.contactPhone },
  };
}

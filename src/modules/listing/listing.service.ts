import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { estimateTotal } from './algorithms/pricing.js';
import { generateSlug } from './algorithms/slug.js';
import { missingPhotos } from './algorithms/status.js';
import type { ListingFeeDto, ListingPayloadDto } from './dto/listing-response.dto.js';
import type { UpsertListingDto } from './dto/upsert-listing.dto.js';
import { ListingSummaryService } from './listing-summary.service.js';

const MAX_SLUG_ATTEMPTS = 5;

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class ListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: ListingSummaryService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Tin hiện tại của nhà (hoặc `null`) kèm số liệu và gợi ý điền sẵn. `houseId` đến từ membership. */
  async getForHouse(houseId: string, userId: string, now: Date = new Date()): Promise<ListingPayloadDto> {
    const [listing, summary, house, user] = await Promise.all([
      this.prisma.roomListing.findUnique({
        where: { houseId },
        include: { photos: { orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      }),
      this.summaries.summary(houseId, now),
      this.prisma.house.findUniqueOrThrow({ where: { id: houseId }, select: { address: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } }),
    ]);

    const suggestions = { locationText: house.address, contactPhone: user.phone };
    if (!listing) {
      return { listing: null, publicUrl: null, summary, estimatedPerPerson: null, missing: [], suggestions };
    }

    const otherFees = listing.otherFees as unknown as ListingFeeDto[];
    return {
      listing: {
        id: listing.id,
        slug: listing.slug,
        status: listing.status,
        closeReason: listing.closeReason,
        locationText: listing.locationText,
        genderWanted: listing.genderWanted,
        rentPerMonth: listing.rentPerMonth,
        otherFees,
        description: listing.description,
        roommateExpectations: listing.roommateExpectations,
        contactPhone: listing.contactPhone,
        showChoreSchedule: listing.showChoreSchedule,
        photos: listing.photos.map((p) => ({
          id: p.id,
          category: p.category,
          url: p.url,
          sortOrder: p.sortOrder,
        })),
        publishedAt: listing.publishedAt,
        closedAt: listing.closedAt,
        updatedAt: listing.updatedAt,
      },
      publicUrl: this.publicUrl(listing.slug),
      summary,
      estimatedPerPerson: estimateTotal({
        rentPerMonth: listing.rentPerMonth,
        utilitiesPerPerson: summary.utilities.perPerson,
        otherFees,
      }),
      missing: missingPhotos(listing.photos),
      suggestions,
    };
  }

  /** Tạo (DRAFT) hoặc cập nhật nội dung. Không đổi `status`, không đổi `slug` của tin đã có. */
  async upsert(houseId: string, userId: string, dto: UpsertListingDto): Promise<ListingPayloadDto> {
    const data = {
      locationText: dto.locationText,
      genderWanted: dto.genderWanted,
      rentPerMonth: dto.rentPerMonth,
      otherFees: dto.otherFees.map(({ name, amount }) => ({ name, amount })),
      description: dto.description,
      roommateExpectations: dto.roommateExpectations,
      contactPhone: dto.contactPhone,
      showChoreSchedule: dto.showChoreSchedule,
    };
    await this.withFreshSlug((slug) =>
      this.prisma.roomListing.upsert({
        where: { houseId },
        create: { houseId, slug, ...data },
        update: data,
      }),
    );
    return this.getForHouse(houseId, userId);
  }

  private publicUrl(slug: string): string {
    const base = this.config.get('PUBLIC_WEB_URL', { infer: true }).replace(/\/+$/, '');
    return `${base}/r/${slug}`;
  }

  /** Slug trùng (hiếm) hoặc hai PUT đầu tiên chạy đua: thử lại, lần sau sẽ rơi vào nhánh update. */
  private async withFreshSlug<T>(write: (slug: string) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        return await write(generateSlug());
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new InternalServerErrorException('Không tạo được liên kết cho tin, thử lại sau.');
  }
}

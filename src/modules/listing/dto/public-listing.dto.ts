import { ApiProperty } from '@nestjs/swagger';
import { GenderWanted, ListingCloseReason } from '../../../generated/prisma/enums.js';
import { ListingFeeDto, ListingSummaryDto } from './listing-response.dto.js';

export class PublicPhotoDto {
  @ApiProperty({ format: 'uuid', description: 'Photo id.' })
  id: string;

  @ApiProperty({ description: 'HTTPS URL of the image.' })
  url: string;
}

export class PublicPhotosDto {
  @ApiProperty({ type: [PublicPhotoDto], description: 'Bedroom photos; the first one is the cover.' })
  BEDROOM: PublicPhotoDto[];

  @ApiProperty({ type: [PublicPhotoDto], description: 'Bathroom photos.' })
  BATHROOM: PublicPhotoDto[];

  @ApiProperty({ type: [PublicPhotoDto], description: 'Living-area photos.' })
  LIVING: PublicPhotoDto[];
}

export class PublicRosterRowDto {
  @ApiProperty({ example: 'Washing dishes', description: 'Chore name.' })
  title: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
    example: [['TV1'], ['TV2'], [], [], [], [], []],
    description: 'Seven cells, Monday to Sunday. Each cell lists the anonymous labels ("TV1", "TV2", ...) of the members on duty that day; real names are never exposed.',
  })
  cells: string[][];
}

export class PublicRosterDto {
  @ApiProperty({ example: '2026-W44', description: 'ISO week the roster belongs to (the current week).' })
  weekKey: string;

  @ApiProperty({ type: [PublicRosterRowDto], description: 'One row per chore.' })
  rows: PublicRosterRowDto[];
}

export class PublicContactDto {
  @ApiProperty({ example: '0901234567', description: 'Contact phone number entered by the admin for this listing.' })
  phone: string;
}

/** Tin đang mở. Không có id, houseId, tên nhà, email, STK, họ tên, userId, memberId, mã mời. */
export class PublicListingOpenDto {
  @ApiProperty({ example: 'x7Kp2QmA', description: 'Listing slug.' })
  slug: string;

  @ApiProperty({ enum: ['OPEN'], description: 'Always `OPEN` in this variant.' })
  status: 'OPEN';

  @ApiProperty({ type: String, nullable: true, example: null, description: 'Always null while the listing is open.' })
  closeReason: null;

  @ApiProperty({ type: Date, nullable: true, description: 'When the listing was first published (ISO 8601 UTC).' })
  publishedAt: Date | null;

  @ApiProperty({ description: 'Short location text.' })
  locationText: string;

  @ApiProperty({ enum: GenderWanted, enumName: 'GenderWanted', description: 'Gender wanted: MALE, FEMALE or ANY.' })
  genderWanted: GenderWanted;

  @ApiProperty({ description: 'Rent in integer VND per person per month.' })
  rentPerMonth: number;

  @ApiProperty({ type: [ListingFeeDto], description: 'Extra monthly fees per person.' })
  otherFees: ListingFeeDto[];

  @ApiProperty({ type: ListingSummaryDto, description: 'Free places and utilities estimate.' })
  summary: ListingSummaryDto;

  @ApiProperty({ description: 'Estimated monthly cost per person in integer VND: rent plus utilities share plus other fees.' })
  estimatedPerPerson: number;

  @ApiProperty({ description: 'Plain-text description of the house.' })
  description: string;

  @ApiProperty({ description: 'Plain-text description of the roommate wanted.' })
  roommateExpectations: string;

  @ApiProperty({ type: PublicPhotosDto, description: 'Photos grouped by area.' })
  photos: PublicPhotosDto;

  @ApiProperty({ type: PublicRosterDto, nullable: true, description: 'This week\'s anonymous chore roster; null when the admin turned it off or no schedule exists for the week yet.' })
  roster: PublicRosterDto | null;

  @ApiProperty({ type: PublicContactDto, description: 'How to contact the house.' })
  contact: PublicContactDto;
}

/** Tin đã đóng hoặc nhà đã đủ người: bản rút gọn, không có liên hệ, lịch trực hay ảnh. */
export class PublicListingClosedDto {
  @ApiProperty({ example: 'x7Kp2QmA', description: 'Listing slug.' })
  slug: string;

  @ApiProperty({ enum: ['CLOSED'], description: 'Always `CLOSED` in this variant.' })
  status: 'CLOSED';

  @ApiProperty({ enum: ListingCloseReason, enumName: 'ListingCloseReason', description: '`FULL` (no places left) or `MANUAL` (the admin closed the listing).' })
  closeReason: ListingCloseReason;

  @ApiProperty({ description: 'Short location text.' })
  locationText: string;

  @ApiProperty({ type: String, nullable: true, description: 'URL of the first bedroom photo, or null when there is none.' })
  coverUrl: string | null;
}

export type PublicListingDto = PublicListingOpenDto | PublicListingClosedDto;

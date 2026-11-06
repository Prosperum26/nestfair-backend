import { ApiProperty } from '@nestjs/swagger';
import {
  GenderWanted,
  ListingCloseReason,
  ListingPhotoCategory,
  ListingStatus,
} from '../../../generated/prisma/enums.js';
import type { MissingPhoto } from '../algorithms/status.js';

export class ListingFeeDto {
  @ApiProperty({ example: 'Wifi', description: 'Name of the extra fee.' })
  name: string;

  @ApiProperty({ description: 'Amount in integer VND per person per month.' })
  amount: number;
}

export class ListingPhotoDto {
  @ApiProperty({ format: 'uuid', description: 'Photo id.' })
  id: string;

  @ApiProperty({ enum: ListingPhotoCategory, enumName: 'ListingPhotoCategory', description: 'Photo group: BEDROOM, BATHROOM or LIVING.' })
  category: ListingPhotoCategory;

  @ApiProperty({ description: 'HTTPS URL of the image.' })
  url: string;

  @ApiProperty({ description: 'Position inside its group; 0 comes first. The cover photo is the bedroom photo with the lowest `sortOrder`.' })
  sortOrder: number;
}

export class ListingDto {
  @ApiProperty({ format: 'uuid', description: 'Listing id. A house has at most one listing.' })
  id: string;

  @ApiProperty({ example: 'x7Kp2QmA', description: 'Public identifier of the listing: 8 base62 characters, never changes after creation. The public page is `/r/{slug}`.' })
  slug: string;

  @ApiProperty({ enum: ListingStatus, enumName: 'ListingStatus', description: '`DRAFT` = hidden, being prepared; `OPEN` = published and visible to anyone with the link; `CLOSED` = no longer looking.' })
  status: ListingStatus;

  @ApiProperty({ enum: ListingCloseReason, enumName: 'ListingCloseReason', nullable: true, description: 'Why a CLOSED listing was closed: `FULL` (the house reached its maximum number of members) or `MANUAL` (the admin closed it). null while not closed.' })
  closeReason: ListingCloseReason | null;

  @ApiProperty({ description: 'Short location text, for example the alley and distance to the university.' })
  locationText: string;

  @ApiProperty({ enum: GenderWanted, enumName: 'GenderWanted', description: 'Gender the house is looking for: MALE, FEMALE or ANY.' })
  genderWanted: GenderWanted;

  @ApiProperty({ description: 'Rent in integer VND per person per month.' })
  rentPerMonth: number;

  @ApiProperty({ type: [ListingFeeDto], description: 'Extra monthly fees per person (wifi, cleaning, ...).' })
  otherFees: ListingFeeDto[];

  @ApiProperty({ description: 'Plain-text description of the house; line breaks are kept.' })
  description: string;

  @ApiProperty({ description: 'Plain-text description of the kind of roommate wanted.' })
  roommateExpectations: string;

  @ApiProperty({ example: '0901234567', description: 'Contact phone number shown to visitors of an open listing.' })
  contactPhone: string;

  @ApiProperty({ description: 'Whether the public page shows this week\'s chore roster (with anonymous labels such as "TV1").' })
  showChoreSchedule: boolean;

  @ApiProperty({ type: [ListingPhotoDto], description: 'Photos ordered by group (bedroom, bathroom, living) and then by `sortOrder`.' })
  photos: ListingPhotoDto[];

  @ApiProperty({ type: Date, nullable: true, description: 'When the listing was first published (ISO 8601 UTC), or null if it never was.' })
  publishedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true, description: 'When the listing was closed (ISO 8601 UTC), or null.' })
  closedAt: Date | null;

  @ApiProperty({ description: 'Last modification time (ISO 8601 UTC).' })
  updatedAt: Date;
}

export class ListingUtilitiesDto {
  @ApiProperty({ type: Number, nullable: true, description: 'Average combined electricity and water cost per month over the last 3 closed months, integer VND. null when there is no data.' })
  avgMonthlyTotal: number | null;

  @ApiProperty({ type: Number, nullable: true, description: '`avgMonthlyTotal` divided by `maxMembers`, integer VND per person. null when there is no data.' })
  perPerson: number | null;

  @ApiProperty({ description: 'How many months of data were averaged (0 to 3).' })
  monthsUsed: number;
}

export class ListingSummaryDto {
  @ApiProperty({ description: 'Number of members currently living in the house.' })
  memberCount: number;

  @ApiProperty({ description: 'Maximum number of members the house allows.' })
  maxMembers: number;

  @ApiProperty({ description: 'Free places: `max(0, maxMembers - memberCount)`, computed live.' })
  slotsOpen: number;

  @ApiProperty({ type: ListingUtilitiesDto, description: 'Estimated electricity and water cost taken from the expense ledger.' })
  utilities: ListingUtilitiesDto;
}

export class ListingSuggestionsDto {
  @ApiProperty({ type: String, nullable: true, description: 'Suggested location text: the house address, to prefill the form.' })
  locationText: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Suggested contact phone: the one in the caller\'s profile.' })
  contactPhone: string | null;
}

export class ListingPayloadDto {
  @ApiProperty({ type: ListingDto, nullable: true, description: 'The house\'s listing, or null when none has been saved yet.' })
  listing: ListingDto | null;

  @ApiProperty({ type: String, nullable: true, example: 'http://localhost:5173/r/x7Kp2QmA', description: 'Full public URL of the listing page (also what the poster QR code points to), or null when there is no listing.' })
  publicUrl: string | null;

  @ApiProperty({ type: ListingSummaryDto, description: 'Places left in the house and the utilities estimate.' })
  summary: ListingSummaryDto;

  @ApiProperty({ type: Number, nullable: true, description: 'Estimated monthly cost per person in integer VND: rent plus the utilities share plus the other fees. null when there is no listing.' })
  estimatedPerPerson: number | null;

  @ApiProperty({ isArray: true, enum: ['PHOTO_BEDROOM', 'PHOTO_BATHROOM', 'PHOTO_LIVING'], description: 'Photo groups that still have no photo. A listing can be published only when this list is empty.' })
  missing: MissingPhoto[];

  @ApiProperty({ type: ListingSuggestionsDto, description: 'Values to prefill the editing form.' })
  suggestions: ListingSuggestionsDto;
}

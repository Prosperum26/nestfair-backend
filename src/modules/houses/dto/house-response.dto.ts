import { ApiProperty } from '@nestjs/swagger';
import { HouseRole } from '../../../generated/prisma/enums.js';

export class HouseMemberDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the member.' })
  userId: string;

  @ApiProperty({ example: 'Minh Hung Tran', description: 'Member display name.' })
  fullName: string;

  @ApiProperty({ type: String, nullable: true, description: 'Avatar image URL, or null.' })
  avatarUrl: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '970407',
    description: 'Napas BIN of the bank where the member receives money, or null.',
  })
  bankBin: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '0123',
    description: 'Last 4 digits of the bank account number. The full number is never returned here; it is only revealed to the payer inside a payment (VietQR) flow.',
  })
  bankAccountLast4: string | null;

  @ApiProperty({ enum: HouseRole, enumName: 'HouseRole', description: 'ADMIN (house admin) or ROOMMATE.' })
  role: HouseRole;

  @ApiProperty({ description: 'When the member joined the house (ISO 8601 UTC).' })
  joinedAt: Date;
}

/** One row of the "my houses" list (house switcher). */
export class HouseSummaryDto {
  @ApiProperty({ format: 'uuid', description: 'House id.' })
  id: string;

  @ApiProperty({ example: 'Sunrise House', description: 'House name.' })
  name: string;

  @ApiProperty({ type: String, nullable: true, description: 'Street address, or null.' })
  address: string | null;

  @ApiProperty({ description: 'Maximum number of active members.' })
  maxMembers: number;

  @ApiProperty({ description: 'Number of members currently living in the house.' })
  memberCount: number;

  @ApiProperty({ enum: HouseRole, enumName: 'HouseRole', description: 'The caller\'s role in this house.' })
  myRole: HouseRole;
}

export class HouseDetailDto {
  @ApiProperty({ format: 'uuid', description: 'House id.' })
  id: string;

  @ApiProperty({ example: 'Sunrise House', description: 'House name.' })
  name: string;

  @ApiProperty({ type: String, nullable: true, description: 'Street address, or null.' })
  address: string | null;

  @ApiProperty({ description: 'Maximum number of active members (2-10).' })
  maxMembers: number;

  @ApiProperty({ type: String, nullable: true, description: 'House rules text, one rule per line, up to 1000 characters; null when no rules are set.' })
  rules: string | null;

  @ApiProperty({ example: 'K7M2QZ', description: 'Current 6-character invite code (letters and digits, no 0/O/1/I).' })
  inviteCode: string;

  @ApiProperty({ description: 'When the invite code stops working (ISO 8601 UTC). Codes are valid for 7 days and are renewed by regenerating them.' })
  inviteExpiresAt: Date;

  @ApiProperty({ description: 'When the house was created (ISO 8601 UTC).' })
  createdAt: Date;

  @ApiProperty({ enum: HouseRole, enumName: 'HouseRole', description: 'The caller\'s role in this house.' })
  myRole: HouseRole;

  @ApiProperty({
    type: [HouseMemberDto],
    description: 'Active members in the order they joined. Members who left are not listed.',
  })
  members: HouseMemberDto[];
}

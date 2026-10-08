import { ApiProperty } from '@nestjs/swagger';
import { HouseRole } from '../../../generated/prisma/enums.js';

export class HouseMemberDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
  @ApiProperty({ enum: HouseRole, enumName: 'HouseRole' }) role: HouseRole;
  @ApiProperty() joinedAt: Date;
}

/** Một dòng trong danh sách "nhà của tôi" (house switcher). */
export class HouseSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) address: string | null;
  @ApiProperty() maxMembers: number;
  @ApiProperty({ description: 'Số thành viên còn ở nhà' }) memberCount: number;
  @ApiProperty({ enum: HouseRole, enumName: 'HouseRole' }) myRole: HouseRole;
}

export class HouseDetailDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) address: string | null;
  @ApiProperty() maxMembers: number;
  @ApiProperty({ type: String, nullable: true }) rules: string | null;
  @ApiProperty({ example: 'K7M2QZ' }) inviteCode: string;
  @ApiProperty() inviteExpiresAt: Date;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ enum: HouseRole, enumName: 'HouseRole' }) myRole: HouseRole;
  @ApiProperty({
    type: [HouseMemberDto],
    description: 'Thành viên còn ở nhà, theo thứ tự vào nhà',
  })
  members: HouseMemberDto[];
}

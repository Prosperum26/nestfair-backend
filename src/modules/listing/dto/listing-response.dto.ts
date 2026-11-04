import { ApiProperty } from '@nestjs/swagger';
import {
  GenderWanted,
  ListingCloseReason,
  ListingPhotoCategory,
  ListingStatus,
} from '../../../generated/prisma/enums.js';
import type { MissingPhoto } from '../algorithms/status.js';

export class ListingFeeDto {
  @ApiProperty({ example: 'Wifi' }) name: string;
  @ApiProperty({ description: 'Số nguyên VNĐ / người / tháng' }) amount: number;
}

export class ListingPhotoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ListingPhotoCategory, enumName: 'ListingPhotoCategory' }) category: ListingPhotoCategory;
  @ApiProperty() url: string;
  @ApiProperty({ description: '0 = đứng đầu nhóm; ảnh bìa là ảnh Phòng ngủ có sortOrder nhỏ nhất' }) sortOrder: number;
}

export class ListingDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'x7Kp2QmA', description: '8 ký tự base62, không đổi sau khi tạo' }) slug: string;
  @ApiProperty({ enum: ListingStatus, enumName: 'ListingStatus' }) status: ListingStatus;
  @ApiProperty({ enum: ListingCloseReason, enumName: 'ListingCloseReason', nullable: true })
  closeReason: ListingCloseReason | null;
  @ApiProperty() locationText: string;
  @ApiProperty({ enum: GenderWanted, enumName: 'GenderWanted' }) genderWanted: GenderWanted;
  @ApiProperty({ description: 'Số nguyên VNĐ / người / tháng' }) rentPerMonth: number;
  @ApiProperty({ type: [ListingFeeDto] }) otherFees: ListingFeeDto[];
  @ApiProperty() description: string;
  @ApiProperty() roommateExpectations: string;
  @ApiProperty({ example: '0901234567' }) contactPhone: string;
  @ApiProperty() showChoreSchedule: boolean;
  @ApiProperty({ type: [ListingPhotoDto], description: 'Sắp theo nhóm (Phòng ngủ, WC, Sinh hoạt) rồi sortOrder' })
  photos: ListingPhotoDto[];
  @ApiProperty({ type: Date, nullable: true }) publishedAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) closedAt: Date | null;
  @ApiProperty() updatedAt: Date;
}

export class ListingUtilitiesDto {
  @ApiProperty({ type: Number, nullable: true, description: 'Trung bình tổng điện + nước mỗi tháng (3 tháng đã khép), VNĐ' })
  avgMonthlyTotal: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'avgMonthlyTotal chia cho maxMembers, VNĐ' })
  perPerson: number | null;
  @ApiProperty({ description: 'Số tháng có dữ liệu được dùng để lấy trung bình (0 đến 3)' }) monthsUsed: number;
}

export class ListingSummaryDto {
  @ApiProperty({ description: 'Số thành viên đang ở' }) memberCount: number;
  @ApiProperty() maxMembers: number;
  @ApiProperty({ description: 'max(0, maxMembers − memberCount), tính trực tiếp' }) slotsOpen: number;
  @ApiProperty({ type: ListingUtilitiesDto }) utilities: ListingUtilitiesDto;
}

export class ListingSuggestionsDto {
  @ApiProperty({ type: String, nullable: true, description: 'Địa chỉ nhà' }) locationText: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'SĐT trong hồ sơ của người đang xem' })
  contactPhone: string | null;
}

export class ListingPayloadDto {
  @ApiProperty({ type: ListingDto, nullable: true, description: 'null khi nhà chưa có tin' }) listing: ListingDto | null;
  @ApiProperty({ type: String, nullable: true, example: 'http://localhost:5173/r/x7Kp2QmA' }) publicUrl: string | null;
  @ApiProperty({ type: ListingSummaryDto }) summary: ListingSummaryDto;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Tiền thuê + điện nước mỗi người + phí khác, VNĐ. null khi chưa có tin',
  })
  estimatedPerPerson: number | null;
  @ApiProperty({
    isArray: true,
    enum: ['PHOTO_BEDROOM', 'PHOTO_BATHROOM', 'PHOTO_LIVING'],
    description: 'Nhóm ảnh còn thiếu để đăng tin',
  })
  missing: MissingPhoto[];
  @ApiProperty({ type: ListingSuggestionsDto }) suggestions: ListingSuggestionsDto;
}

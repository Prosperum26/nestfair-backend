import { ApiProperty } from '@nestjs/swagger';
import { GenderWanted, ListingCloseReason } from '../../../generated/prisma/enums.js';
import { ListingFeeDto, ListingSummaryDto } from './listing-response.dto.js';

export class PublicPhotoDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() url: string;
}

export class PublicPhotosDto {
  @ApiProperty({ type: [PublicPhotoDto] }) BEDROOM: PublicPhotoDto[];
  @ApiProperty({ type: [PublicPhotoDto] }) BATHROOM: PublicPhotoDto[];
  @ApiProperty({ type: [PublicPhotoDto] }) LIVING: PublicPhotoDto[];
}

export class PublicRosterRowDto {
  @ApiProperty({ example: 'Rửa chén' }) title: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
    example: [['TV1'], ['TV2'], [], [], [], [], []],
    description: '7 phần tử (T2…CN); mỗi ô là danh sách nhãn ẩn danh',
  })
  cells: string[][];
}

export class PublicRosterDto {
  @ApiProperty({ example: '2026-W44' }) weekKey: string;
  @ApiProperty({ type: [PublicRosterRowDto] }) rows: PublicRosterRowDto[];
}

export class PublicContactDto {
  @ApiProperty({ example: '0901234567' }) phone: string;
}

/** Tin đang mở. Không có id, houseId, tên nhà, email, STK, họ tên, userId, memberId, mã mời. */
export class PublicListingOpenDto {
  @ApiProperty({ example: 'x7Kp2QmA' }) slug: string;
  @ApiProperty({ enum: ['OPEN'] }) status: 'OPEN';
  @ApiProperty({ type: String, nullable: true, example: null }) closeReason: null;
  @ApiProperty({ type: Date, nullable: true }) publishedAt: Date | null;
  @ApiProperty() locationText: string;
  @ApiProperty({ enum: GenderWanted, enumName: 'GenderWanted' }) genderWanted: GenderWanted;
  @ApiProperty({ description: 'Số nguyên VNĐ / người / tháng' }) rentPerMonth: number;
  @ApiProperty({ type: [ListingFeeDto] }) otherFees: ListingFeeDto[];
  @ApiProperty({ type: ListingSummaryDto }) summary: ListingSummaryDto;
  @ApiProperty({ description: 'Tiền thuê + điện nước mỗi người + phí khác, VNĐ' }) estimatedPerPerson: number;
  @ApiProperty() description: string;
  @ApiProperty() roommateExpectations: string;
  @ApiProperty({ type: PublicPhotosDto }) photos: PublicPhotosDto;
  @ApiProperty({ type: PublicRosterDto, nullable: true, description: 'null khi tắt hiển thị hoặc tuần này chưa có lịch' })
  roster: PublicRosterDto | null;
  @ApiProperty({ type: PublicContactDto }) contact: PublicContactDto;
}

/** Tin đã đóng hoặc nhà đã đủ người: bản rút gọn, không có liên hệ, lịch trực hay ảnh. */
export class PublicListingClosedDto {
  @ApiProperty({ example: 'x7Kp2QmA' }) slug: string;
  @ApiProperty({ enum: ['CLOSED'] }) status: 'CLOSED';
  @ApiProperty({ enum: ListingCloseReason, enumName: 'ListingCloseReason' }) closeReason: ListingCloseReason;
  @ApiProperty() locationText: string;
  @ApiProperty({ type: String, nullable: true, description: 'Ảnh Phòng ngủ đứng đầu, null nếu chưa có' }) coverUrl: string | null;
}

export type PublicListingDto = PublicListingOpenDto | PublicListingClosedDto;

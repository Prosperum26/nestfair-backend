import { ApiProperty } from '@nestjs/swagger';
import { ExpenseCategory, SplitType } from '../../../generated/prisma/enums.js';

export class UserBriefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
}

export class ExpenseShareDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
  @ApiProperty({ description: 'Số nguyên VNĐ' }) amount: number;
}

export class ExpenseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ExpenseCategory, enumName: 'ExpenseCategory' }) category: ExpenseCategory;
  @ApiProperty({ description: 'Số nguyên VNĐ' }) totalAmount: number;
  @ApiProperty({ enum: SplitType, enumName: 'SplitType' }) splitType: SplitType;
  @ApiProperty() spentAt: Date;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, nullable: true }) receiptImageUrl: string | null;
  @ApiProperty({ type: UserBriefDto }) payer: UserBriefDto;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ type: [ExpenseShareDto] }) splits: ExpenseShareDto[];
  @ApiProperty({ description: 'Phần của người đang xem (0 nếu không chịu phần nào)' }) myShare: number;
  @ApiProperty({ description: 'Người trả, người ghi hoặc trưởng phòng mới được sửa/xóa' }) canEdit: boolean;
}

export class UploadedUrlDto {
  @ApiProperty({ example: 'https://res.cloudinary.com/<cloud>/image/upload/v1/nestfair/houses/<id>/receipts/abc.jpg' })
  url: string;
}

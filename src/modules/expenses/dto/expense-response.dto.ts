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

export class ExpenseItemDto {
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Thành tiền của dòng, số nguyên VNĐ' }) lineTotal: number;
  @ApiProperty({ type: [String], format: 'uuid', description: 'Người dùng món (chỉ khoản chia theo món); rỗng nếu không' }) userIds: string[];
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
  @ApiProperty({ type: [ExpenseItemDto], description: 'Danh sách món của hóa đơn (rỗng nếu khoản không có)' }) items: ExpenseItemDto[];
  @ApiProperty({ description: 'Phần của người đang xem (0 nếu không chịu phần nào)' }) myShare: number;
  @ApiProperty({ description: 'Người trả, người ghi hoặc trưởng phòng mới được sửa/xóa' }) canEdit: boolean;
}

export class UploadedUrlDto {
  @ApiProperty({ example: 'https://res.cloudinary.com/<cloud>/image/upload/v1/nestfair/houses/<id>/receipts/abc.jpg' })
  url: string;
}

export class CategoryTotalDto {
  @ApiProperty({ enum: ExpenseCategory, enumName: 'ExpenseCategory' }) category: ExpenseCategory;
  @ApiProperty({ description: 'Số nguyên VNĐ' }) amount: number;
  @ApiProperty() count: number;
}

export class ExpenseSummaryDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ description: 'Tổng chi của cả nhà trong tháng' }) totalAmount: number;
  @ApiProperty() expenseCount: number;
  @ApiProperty({ description: 'Số người có phần chia trong tháng' }) participantCount: number;
  @ApiProperty({ description: 'Tổng các hóa đơn bạn trả trước' }) paidByMe: number;
  @ApiProperty() paidByMeCount: number;
  @ApiProperty({ description: 'Tổng phần bạn phải chịu' }) myShare: number;
  @ApiProperty({ description: 'paidByMe − myShare: dương = được nhận lại, âm = cần trả thêm (riêng tháng này)' }) diff: number;
  @ApiProperty({ type: [CategoryTotalDto], description: 'Sắp giảm dần theo số tiền' }) byCategory: CategoryTotalDto[];
}

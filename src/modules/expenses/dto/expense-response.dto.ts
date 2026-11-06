import { ApiProperty } from '@nestjs/swagger';
import { ExpenseCategory, SplitType } from '../../../generated/prisma/enums.js';

export class UserBriefDto {
  @ApiProperty({ format: 'uuid', description: 'User id.' })
  id: string;

  @ApiProperty({ description: 'Full name of the user.' })
  fullName: string;

  @ApiProperty({ type: String, nullable: true, description: 'Avatar image URL, or null when the user has none.' })
  avatarUrl: string | null;
}

export class ExpenseShareDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the member who bears this share.' })
  userId: string;

  @ApiProperty({ description: 'Full name of the member.' })
  fullName: string;

  @ApiProperty({ type: String, nullable: true, description: 'Avatar image URL, or null.' })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Amount this member owes for the expense, in integer VND. The shares of one expense always add up to its total.' })
  amount: number;
}

export class ExpenseItemDto {
  @ApiProperty({ description: 'Item name as written on the receipt.' })
  name: string;

  @ApiProperty({ description: 'Line total of the item in integer VND.' })
  lineTotal: number;

  @ApiProperty({ type: [String], format: 'uuid', description: 'User ids of the members who share this item. Only filled for ITEMIZED expenses; empty otherwise.' })
  userIds: string[];
}

export class ExpenseDto {
  @ApiProperty({ format: 'uuid', description: 'Expense id.' })
  id: string;

  @ApiProperty({ description: 'Short title, for example "October electricity".' })
  title: string;

  @ApiProperty({ enum: ExpenseCategory, enumName: 'ExpenseCategory', description: 'Category: FOOD, RENT, ELECTRICITY, WATER, INTERNET, SUPPLIES, GIFT (thank-you gift created by an accepted swap) or OTHER.' })
  category: ExpenseCategory;

  @ApiProperty({ description: 'Total amount in integer VND (no decimals).' })
  totalAmount: number;

  @ApiProperty({ enum: SplitType, enumName: 'SplitType', description: 'How the total was divided: EQUAL, CUSTOM, EXACT or ITEMIZED.' })
  splitType: SplitType;

  @ApiProperty({ description: 'When the money was spent (ISO 8601 UTC).' })
  spentAt: Date;

  @ApiProperty({ type: String, nullable: true, description: 'Free-text note, or null.' })
  note: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'URL of the receipt photo, or null.' })
  receiptImageUrl: string | null;

  @ApiProperty({ type: UserBriefDto, description: 'The member who paid up front and is owed the money back.' })
  payer: UserBriefDto;

  @ApiProperty({ format: 'uuid', description: 'User id of the member who recorded the expense.' })
  createdById: string;

  @ApiProperty({ description: 'When the expense was recorded (ISO 8601 UTC).' })
  createdAt: Date;

  @ApiProperty({ description: 'When the expense was last edited (ISO 8601 UTC).' })
  updatedAt: Date;

  @ApiProperty({ type: [ExpenseShareDto], description: 'Who owes what. The amounts add up exactly to `totalAmount`.' })
  splits: ExpenseShareDto[];

  @ApiProperty({ type: [ExpenseItemDto], description: 'Receipt line items; empty when the expense has none.' })
  items: ExpenseItemDto[];

  @ApiProperty({ description: 'The caller\'s own share in integer VND; 0 when the caller bears no part of it.' })
  myShare: number;

  @ApiProperty({ description: 'true when the caller may edit or delete the expense: the payer, the creator or the house admin.' })
  canEdit: boolean;
}

export class UploadedUrlDto {
  @ApiProperty({ example: 'https://res.cloudinary.com/<cloud>/image/upload/v1/nestfair/houses/<id>/receipts/abc.jpg', description: 'HTTPS URL of the stored image. Pass it back as `receiptImageUrl` or `proofUrl`; only URLs issued by this server are accepted.' })
  url: string;
}

export class CategoryTotalDto {
  @ApiProperty({ enum: ExpenseCategory, enumName: 'ExpenseCategory', description: 'Expense category.' })
  category: ExpenseCategory;

  @ApiProperty({ description: 'Total spent in this category during the month, integer VND.' })
  amount: number;

  @ApiProperty({ description: 'Number of expenses in this category.' })
  count: number;
}

export class ExpenseSummaryDto {
  @ApiProperty({ example: '2026-10', description: 'The month summarised (YYYY-MM, Vietnam time).' })
  month: string;

  @ApiProperty({ description: 'Total spent by the whole house in the month, integer VND.' })
  totalAmount: number;

  @ApiProperty({ description: 'Number of expenses in the month.' })
  expenseCount: number;

  @ApiProperty({ description: 'Number of distinct members who bear a share in the month.' })
  participantCount: number;

  @ApiProperty({ description: 'Sum of the expenses the caller paid up front.' })
  paidByMe: number;

  @ApiProperty({ description: 'Number of expenses the caller paid up front.' })
  paidByMeCount: number;

  @ApiProperty({ description: 'Sum of the shares the caller bears.' })
  myShare: number;

  @ApiProperty({ description: '`paidByMe` minus `myShare` for this month only: positive means the caller is owed money back, negative means the caller owes.' })
  diff: number;

  @ApiProperty({ type: [CategoryTotalDto], description: 'Totals per category, largest amount first.' })
  byCategory: CategoryTotalDto[];
}

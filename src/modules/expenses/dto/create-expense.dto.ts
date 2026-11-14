import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ExpenseCategory, SplitType } from '../../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Trần một khoản chi (1 tỷ VNĐ): chặn gõ nhầm số và giữ mọi tổng trong phạm vi Int của Postgres. */
export const MAX_AMOUNT = 1_000_000_000;

export class ExactSplitDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the member who owes this amount. Must be an active member of the house.' })
  @IsUUID('all', { message: 'userId không hợp lệ.' })
  userId: string;

  @ApiProperty({
    minimum: 0,
    maximum: MAX_AMOUNT,
    example: 110_000,
    description: 'Amount this member owes, in integer VND. All amounts in `splits` must add up to `totalAmount`.',
  })
  @IsInt({ message: 'Số tiền phải là số nguyên VNĐ.' })
  @Min(0, { message: 'Số tiền không được âm.' })
  @Max(MAX_AMOUNT, { message: 'Số tiền quá lớn.' })
  amount: number;
}

/** Một món trên hóa đơn và những người cùng dùng món đó (chia theo món). */
export class ItemizedItemDto {
  @ApiProperty({ example: 'Eggs, box of 10', minLength: 1, maxLength: 80, description: 'Item name as written on the receipt (1-80 characters).' })
  @Transform(trim)
  @IsString()
  @Length(1, 80, { message: 'Tên món cần từ 1 đến 80 ký tự.' })
  name: string;

  @ApiProperty({ minimum: 1, maximum: MAX_AMOUNT, example: 32_000, description: 'Line total of the item in integer VND.' })
  @IsInt({ message: 'Tiền món phải là số nguyên VNĐ.' })
  @Min(1, { message: 'Tiền món phải lớn hơn 0.' })
  @Max(MAX_AMOUNT, { message: 'Tiền món quá lớn.' })
  lineTotal: number;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'User ids of the members who share this item; its line total is divided equally among them. At least one member is required when `splitType` is ITEMIZED. For the other split types the field is ignored and stored as an empty list.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'Danh sách người dùng món bị trùng.' })
  @IsUUID('all', { each: true, message: 'userIds không hợp lệ.' })
  userIds?: string[];
}

export class CreateExpenseDto {
  @ApiProperty({ example: 'October electricity', minLength: 1, maxLength: 80, description: 'Short title of the expense (1-80 characters).' })
  @Transform(trim)
  @IsString()
  @Length(1, 80, { message: 'Tên khoản chi cần từ 1 đến 80 ký tự.' })
  title: string;

  @ApiProperty({
    enum: ExpenseCategory,
    enumName: 'ExpenseCategory',
    description: 'Category: FOOD, RENT, ELECTRICITY, WATER, INTERNET, SUPPLIES, GIFT or OTHER.',
  })
  @IsEnum(ExpenseCategory, { message: 'Danh mục không hợp lệ.' })
  category: ExpenseCategory;

  @ApiProperty({
    minimum: 1,
    maximum: MAX_AMOUNT,
    example: 840_000,
    description: 'Total amount in integer VND, from 1 to 1,000,000,000. It is divided among the members according to `splitType`.',
  })
  @IsInt({ message: 'Tổng tiền phải là số nguyên VNĐ.' })
  @Min(1, { message: 'Tổng tiền phải lớn hơn 0.' })
  @Max(MAX_AMOUNT, { message: 'Tổng tiền quá lớn.' })
  totalAmount: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'User id of the member who paid up front and is owed the money back. Defaults to the caller. Must be an active member of the house.',
  })
  @IsOptional()
  @IsUUID('all', { message: 'payerId không hợp lệ.' })
  payerId?: string;

  @ApiProperty({
    enum: SplitType,
    enumName: 'SplitType',
    description:
      '`EQUAL` divides the total equally among all active members. `CUSTOM` divides it equally among `participantIds`. `EXACT` uses the amount given for each member in `splits`. `ITEMIZED` divides it by receipt line and requires `items`. Any remainder of an uneven division is spread one dong at a time starting from the first member in the list, so the shares always add up exactly to the total.',
  })
  @IsEnum(SplitType, { message: 'Kiểu chia không hợp lệ.' })
  splitType: SplitType;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'CUSTOM only (required): user ids of the members who share the expense equally. Each must be an active member of the house.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Chọn ít nhất một người.' })
  @ArrayUnique({ message: 'Danh sách người bị trùng.' })
  @IsUUID('all', { each: true, message: 'participantIds không hợp lệ.' })
  participantIds?: string[];

  @ApiPropertyOptional({
    type: [ExactSplitDto],
    description: 'EXACT only (required): the amount each member owes. The amounts must add up to `totalAmount`, otherwise the request fails with `SPLIT_SUM_MISMATCH`.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Nhập số tiền cho ít nhất một người.' })
  @ValidateNested({ each: true })
  @Type(() => ExactSplitDto)
  splits?: ExactSplitDto[];

  @ApiPropertyOptional({
    type: [ItemizedItemDto],
    description:
      'Receipt line items, at most 100, stored so the receipt can be reviewed later with any split type. Required for ITEMIZED (each item needs at least one member) and used to divide the total: the difference between `totalAmount` and the sum of the items (discounts, fees) is shared in proportion to what each member\'s items cost.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100, { message: 'Tối đa 100 món.' })
  @ValidateNested({ each: true })
  @Type(() => ItemizedItemDto)
  items?: ItemizedItemDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Id of the OCR draft (from POST /houses/{houseId}/expenses/scan) this expense is created from. Accepted only on creation; each draft can be used once, otherwise `RECEIPT_SCAN_USED`.',
  })
  @IsOptional()
  @IsUUID('all', { message: 'receiptScanId không hợp lệ.' })
  receiptScanId?: string;

  @ApiPropertyOptional({
    example: '2026-10-01T12:00:00+07:00',
    description: 'When the money was spent (ISO 8601). Defaults to now and cannot be in the future.',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Ngày chi không hợp lệ.' })
  spentAt?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true, description: 'Free-text note (up to 200 characters). Send null on update to clear it.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Ghi chú tối đa 200 ký tự.' })
  note?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'HTTPS URL returned by POST /houses/{houseId}/expenses/receipt-image (other URLs are refused with `RECEIPT_URL_INVALID`). Send null on update to remove the photo.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Ảnh hóa đơn không hợp lệ.' })
  receiptImageUrl?: string | null;
}

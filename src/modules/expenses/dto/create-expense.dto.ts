import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
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
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'userId không hợp lệ.' })
  userId: string;

  @ApiProperty({ minimum: 0, example: 110_000, description: 'Số nguyên VNĐ' })
  @IsInt({ message: 'Số tiền phải là số nguyên VNĐ.' })
  @Min(0, { message: 'Số tiền không được âm.' })
  @Max(MAX_AMOUNT, { message: 'Số tiền quá lớn.' })
  amount: number;
}

export class CreateExpenseDto {
  @ApiProperty({ example: 'Tiền điện tháng 10', minLength: 1, maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80, { message: 'Tên khoản chi cần từ 1 đến 80 ký tự.' })
  title: string;

  @ApiProperty({ enum: ExpenseCategory, enumName: 'ExpenseCategory' })
  @IsEnum(ExpenseCategory, { message: 'Danh mục không hợp lệ.' })
  category: ExpenseCategory;

  @ApiProperty({ minimum: 1, maximum: MAX_AMOUNT, example: 840_000, description: 'Tổng tiền, số nguyên VNĐ' })
  @IsInt({ message: 'Tổng tiền phải là số nguyên VNĐ.' })
  @Min(1, { message: 'Tổng tiền phải lớn hơn 0.' })
  @Max(MAX_AMOUNT, { message: 'Tổng tiền quá lớn.' })
  totalAmount: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Người trả trước. Mặc định là bạn.' })
  @IsOptional()
  @IsUUID('all', { message: 'payerId không hợp lệ.' })
  payerId?: string;

  @ApiProperty({
    enum: SplitType,
    enumName: 'SplitType',
    description: 'EQUAL = chia đều cả nhà, CUSTOM = chia đều cho người được chọn, EXACT = số tiền từng người, ITEMIZED = chưa hỗ trợ',
  })
  @IsEnum(SplitType, { message: 'Kiểu chia không hợp lệ.' })
  splitType: SplitType;

  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'Chỉ dùng với CUSTOM: người cùng chịu khoản chi' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Chọn ít nhất một người.' })
  @ArrayUnique({ message: 'Danh sách người bị trùng.' })
  @IsUUID('all', { each: true, message: 'participantIds không hợp lệ.' })
  participantIds?: string[];

  @ApiPropertyOptional({ type: [ExactSplitDto], description: 'Chỉ dùng với EXACT: tổng phải bằng totalAmount' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Nhập số tiền cho ít nhất một người.' })
  @ValidateNested({ each: true })
  @Type(() => ExactSplitDto)
  splits?: ExactSplitDto[];

  @ApiPropertyOptional({ example: '2026-10-01T12:00:00+07:00', description: 'Thời điểm chi. Mặc định là bây giờ.' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Ngày chi không hợp lệ.' })
  spentAt?: string;

  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(200, { message: 'Ghi chú tối đa 200 ký tự.' })
  note?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'URL trả về từ POST /expenses/receipt-image. null để gỡ ảnh.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Ảnh hóa đơn không hợp lệ.' })
  receiptImageUrl?: string | null;
}

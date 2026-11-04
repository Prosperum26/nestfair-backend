import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GenderWanted } from '../../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const MAX_RENT = 50_000_000;
export const MAX_FEE = 10_000_000;
export const MAX_OTHER_FEES = 8;

export class OtherFeeInputDto {
  @ApiProperty({ example: 'Wifi', maxLength: 40 })
  @Transform(trim)
  @IsString()
  @Length(1, 40, { message: 'Tên khoản phí cần từ 1 đến 40 ký tự.' })
  name: string;

  @ApiProperty({ example: 60_000, minimum: 0, maximum: MAX_FEE, description: 'Số nguyên VNĐ / người / tháng' })
  @IsInt({ message: 'Số tiền phải là số nguyên VNĐ.' })
  @Min(0, { message: 'Số tiền không được âm.' })
  @Max(MAX_FEE, { message: 'Mỗi khoản phí tối đa 10.000.000đ.' })
  amount: number;
}

/** Nội dung tin. Không có `status`, `slug`, `houseId`: đổi trạng thái đi qua route riêng (B6). */
export class UpsertListingDto {
  @ApiProperty({ example: 'Hẻm 51 Linh Trung, Thủ Đức · 5 phút đi bộ tới UIT', minLength: 3, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(3, 120, { message: 'Vị trí cần từ 3 đến 120 ký tự.' })
  locationText: string;

  @ApiProperty({ enum: GenderWanted, enumName: 'GenderWanted' })
  @IsEnum(GenderWanted, { message: 'Giới tính cần tìm không hợp lệ.' })
  genderWanted: GenderWanted;

  @ApiProperty({ example: 1_200_000, minimum: 1, maximum: MAX_RENT, description: 'Số nguyên VNĐ / người / tháng' })
  @IsInt({ message: 'Tiền thuê phải là số nguyên VNĐ.' })
  @Min(1, { message: 'Tiền thuê phải lớn hơn 0.' })
  @Max(MAX_RENT, { message: 'Tiền thuê tối đa 50.000.000đ.' })
  rentPerMonth: number;

  @ApiPropertyOptional({ type: [OtherFeeInputDto], maxItems: MAX_OTHER_FEES, default: [] })
  @IsArray()
  @ArrayMaxSize(MAX_OTHER_FEES, { message: 'Tối đa 8 khoản phí khác.' })
  @ValidateNested({ each: true })
  @Type(() => OtherFeeInputDto)
  otherFees: OtherFeeInputDto[] = [];

  @ApiPropertyOptional({ maxLength: 1000, default: '', description: 'Chữ thuần, giữ xuống dòng' })
  @IsString()
  @MaxLength(1000, { message: 'Mô tả tối đa 1000 ký tự.' })
  description: string = '';

  @ApiPropertyOptional({ maxLength: 500, default: '', description: 'Chữ thuần, giữ xuống dòng' })
  @IsString()
  @MaxLength(500, { message: 'Mong muốn tối đa 500 ký tự.' })
  roommateExpectations: string = '';

  @ApiProperty({ example: '0901234567', description: '10 số, bắt đầu bằng 0. Khoảng trắng được bỏ qua.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\s+/g, '') : value))
  @Matches(/^0\d{9}$/, { message: 'Số điện thoại cần 10 số, bắt đầu bằng 0.' })
  contactPhone: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  showChoreSchedule: boolean = true;
}

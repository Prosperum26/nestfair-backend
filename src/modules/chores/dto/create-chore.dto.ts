import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ChoreFrequency, RotationMode } from '../../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** HH:mm giờ nhà, 00:00–23:59. */
export const DUE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateChoreDto {
  @ApiProperty({ example: 'Đổ rác', minLength: 1, maxLength: 60 })
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'Tên việc cần từ 1 đến 60 ký tự.' })
  title: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 2, description: 'Độ nặng của việc' })
  @Type(() => Number)
  @IsInt({ message: 'Độ nặng phải là số nguyên.' })
  @Min(1, { message: 'Độ nặng từ 1 đến 5.' })
  @Max(5, { message: 'Độ nặng từ 1 đến 5.' })
  weight: number;

  @ApiProperty({
    enum: ChoreFrequency,
    enumName: 'ChoreFrequency',
    description: 'DAILY = cả tuần, WEEKLY = các ngày chọn, ADHOC = đột xuất (không xoay)',
  })
  @IsEnum(ChoreFrequency, { message: 'Tần suất phải là DAILY, WEEKLY hoặc ADHOC.' })
  frequency: ChoreFrequency;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 4],
    description: 'ISO 1 = Thứ Hai … 7 = Chủ Nhật. Bỏ qua với DAILY/ADHOC.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'Ngày lặp không được trùng nhau.' })
  @IsInt({ each: true, message: 'Ngày lặp phải là số từ 1 đến 7.' })
  @Min(1, { each: true, message: 'Ngày lặp phải là số từ 1 đến 7.' })
  @Max(7, { each: true, message: 'Ngày lặp phải là số từ 1 đến 7.' })
  recurrenceDays?: number[];

  @ApiPropertyOptional({ example: '21:00', description: 'Giờ hạn (giờ nhà), mặc định 21:00' })
  @IsOptional()
  @Matches(DUE_TIME, { message: 'Giờ hạn phải có dạng HH:mm, ví dụ 21:00.' })
  dueTime?: string;

  @ApiPropertyOptional({
    enum: RotationMode,
    enumName: 'RotationMode',
    description: 'Mặc định: lặp ≥ 3 ngày/tuần → PER_OCCURRENCE, ngược lại WEEK_BLOCK',
  })
  @IsOptional()
  @IsEnum(RotationMode, { message: 'Chế độ xoay phải là WEEK_BLOCK hoặc PER_OCCURRENCE.' })
  rotationMode?: RotationMode;

  @ApiPropertyOptional({ minimum: 1, maximum: 6, description: 'Chỉ PER_OCCURRENCE: không làm lại trong N lần kế tiếp' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Giãn cách từ 1 đến 6 lần.' })
  @Max(6, { message: 'Giãn cách từ 1 đến 6 lần.' })
  occurrenceGap?: number;
}

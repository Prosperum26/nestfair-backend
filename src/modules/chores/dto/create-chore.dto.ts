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
  @ApiProperty({ example: 'Take out the trash', minLength: 1, maxLength: 60, description: 'Chore name shown on the schedule (1-60 characters).' })
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'Tên việc cần từ 1 đến 60 ký tự.' })
  title: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 2, description: 'Effort weight from 1 (light) to 5 (heavy). The scheduler balances the total weight per person each week.' })
  @Type(() => Number)
  @IsInt({ message: 'Độ nặng phải là số nguyên.' })
  @Min(1, { message: 'Độ nặng từ 1 đến 5.' })
  @Max(5, { message: 'Độ nặng từ 1 đến 5.' })
  weight: number;

  @ApiProperty({
    enum: ChoreFrequency,
    enumName: 'ChoreFrequency',
    description: '`DAILY` = every day of the week, `WEEKLY` = only on `recurrenceDays`, `ADHOC` = one-off chore that is not part of the rotation.',
  })
  @IsEnum(ChoreFrequency, { message: 'Tần suất phải là DAILY, WEEKLY hoặc ADHOC.' })
  frequency: ChoreFrequency;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 4],
    description: 'ISO weekdays when the chore occurs: 1 = Monday ... 7 = Sunday. Ignored for DAILY and ADHOC.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'Ngày lặp không được trùng nhau.' })
  @IsInt({ each: true, message: 'Ngày lặp phải là số từ 1 đến 7.' })
  @Min(1, { each: true, message: 'Ngày lặp phải là số từ 1 đến 7.' })
  @Max(7, { each: true, message: 'Ngày lặp phải là số từ 1 đến 7.' })
  recurrenceDays?: number[];

  @ApiPropertyOptional({ example: '21:00', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Deadline time of day in the house time zone (Asia/Ho_Chi_Minh), format HH:mm. Defaults to 21:00.' })
  @IsOptional()
  @Matches(DUE_TIME, { message: 'Giờ hạn phải có dạng HH:mm, ví dụ 21:00.' })
  dueTime?: string;

  @ApiPropertyOptional({
    enum: RotationMode,
    enumName: 'RotationMode',
    description: '`PER_OCCURRENCE` rotates the person on every occurrence; `WEEK_BLOCK` gives the whole week of that chore to one person. Default: PER_OCCURRENCE when the chore occurs on 3 or more days a week, otherwise WEEK_BLOCK.',
  })
  @IsOptional()
  @IsEnum(RotationMode, { message: 'Chế độ xoay phải là WEEK_BLOCK hoặc PER_OCCURRENCE.' })
  rotationMode?: RotationMode;

  @ApiPropertyOptional({ minimum: 1, maximum: 6, description: 'PER_OCCURRENCE only: the same person is not given this chore again within the next N occurrences.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Giãn cách từ 1 đến 6 lần.' })
  @Max(6, { message: 'Giãn cách từ 1 đến 6 lần.' })
  occurrenceGap?: number;
}

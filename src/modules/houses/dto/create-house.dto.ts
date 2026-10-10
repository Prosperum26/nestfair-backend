import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateHouseDto {
  @ApiProperty({ example: 'Nhà 12A' })
  @Transform(trim)
  @IsString()
  @Length(2, 60, { message: 'Tên nhà cần từ 2 đến 60 ký tự.' })
  name: string;

  @ApiPropertyOptional({ example: 'Hẻm 51, Linh Trung, Thủ Đức' })
  @IsOptional()
  // Chuỗi rỗng coi như không nhập.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(120, { message: 'Địa chỉ tối đa 120 ký tự.' })
  address?: string;

  @ApiProperty({ minimum: 2, maximum: 10, example: 4 })
  @Type(() => Number)
  @IsInt({ message: 'Số người phải là số nguyên.' })
  @Min(2, { message: 'Nhà cần ít nhất 2 người.' })
  @Max(10, { message: 'Nhà tối đa 10 người.' })
  maxMembers: number;
}

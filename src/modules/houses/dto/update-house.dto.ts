import { ApiPropertyOptional } from '@nestjs/swagger';
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

/** Mọi trường đều tùy chọn; `address` và `rules` gửi chuỗi rỗng để xóa. */
export class UpdateHouseDto {
  @ApiPropertyOptional({ example: 'Nhà 12A' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 60, { message: 'Tên nhà cần từ 2 đến 60 ký tự.' })
  name?: string;

  @ApiPropertyOptional({ description: 'Chuỗi rỗng để xóa địa chỉ' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120, { message: 'Địa chỉ tối đa 120 ký tự.' })
  address?: string;

  @ApiPropertyOptional({
    minimum: 2,
    maximum: 10,
    description: 'Không thấp hơn số người đang ở',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số người phải là số nguyên.' })
  @Min(2, { message: 'Nhà cần ít nhất 2 người.' })
  @Max(10, { message: 'Nhà tối đa 10 người.' })
  maxMembers?: number;

  @ApiPropertyOptional({
    description: 'Nội quy nhà, tối đa 1000 ký tự; chuỗi rỗng để xóa',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000, { message: 'Nội quy tối đa 1000 ký tự.' })
  rules?: string;
}

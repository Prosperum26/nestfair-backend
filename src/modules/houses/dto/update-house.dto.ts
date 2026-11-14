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
  @ApiPropertyOptional({ example: 'Sunrise House', minLength: 2, maxLength: 60, description: 'New house name (2-60 characters).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 60, { message: 'Tên nhà cần từ 2 đến 60 ký tự.' })
  name?: string;

  @ApiPropertyOptional({ maxLength: 120, description: 'New address (up to 120 characters). An empty string clears the address.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120, { message: 'Địa chỉ tối đa 120 ký tự.' })
  address?: string;

  @ApiPropertyOptional({
    minimum: 2,
    maximum: 10,
    description: 'New member capacity, 2-10. Cannot be lower than the number of active members. Raising it can reopen a listing that was closed as full.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số người phải là số nguyên.' })
  @Min(2, { message: 'Nhà cần ít nhất 2 người.' })
  @Max(10, { message: 'Nhà tối đa 10 người.' })
  maxMembers?: number;

  @ApiPropertyOptional({
    maxLength: 1000,
    description: 'House rules text, up to 1000 characters; one rule per line. An empty string clears the rules.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000, { message: 'Nội quy tối đa 1000 ký tự.' })
  rules?: string;
}

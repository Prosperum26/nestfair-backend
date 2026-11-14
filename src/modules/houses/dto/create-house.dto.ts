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
  @ApiProperty({ example: 'Sunrise House', minLength: 2, maxLength: 60, description: 'House name (2-60 characters, trimmed). Also the text the admin must retype to dissolve the house.' })
  @Transform(trim)
  @IsString()
  @Length(2, 60, { message: 'Tên nhà cần từ 2 đến 60 ký tự.' })
  name: string;

  @ApiPropertyOptional({ example: '51 Alley, Linh Trung Ward, Thu Duc City', maxLength: 120, description: 'Street address (up to 120 characters). An empty string counts as not provided.' })
  @IsOptional()
  // Chuỗi rỗng coi như không nhập.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(120, { message: 'Địa chỉ tối đa 120 ký tự.' })
  address?: string;

  @ApiProperty({ minimum: 2, maximum: 10, example: 4, description: 'Maximum number of active members, 2-10. The creator counts as the first member.' })
  @Type(() => Number)
  @IsInt({ message: 'Số người phải là số nguyên.' })
  @Min(2, { message: 'Nhà cần ít nhất 2 người.' })
  @Max(10, { message: 'Nhà tối đa 10 người.' })
  maxMembers: number;
}

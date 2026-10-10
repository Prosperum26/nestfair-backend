import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateChoreDto {
  @ApiPropertyOptional({ example: 'Lau nhà' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60, { message: 'Tên việc cần từ 1 đến 60 ký tự.' })
  title?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Độ nặng phải là số nguyên.' })
  @Min(1, { message: 'Độ nặng từ 1 đến 5.' })
  @Max(5, { message: 'Độ nặng từ 1 đến 5.' })
  weight?: number;

  @ApiPropertyOptional({ description: 'false = tạm ngưng, không xếp lịch' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

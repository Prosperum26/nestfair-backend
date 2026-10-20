import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RejectSwapDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Lời từ chối (tùy chọn)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100, { message: 'Lời từ chối tối đa 100 ký tự.' })
  reason?: string;
}

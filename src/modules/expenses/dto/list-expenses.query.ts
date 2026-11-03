import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ExpenseCategory } from '../../../generated/prisma/enums.js';

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class MonthQuery {
  @ApiPropertyOptional({ example: '2026-10', description: 'Tháng theo giờ VN (YYYY-MM). Mặc định là tháng hiện tại.' })
  @IsOptional()
  @Matches(MONTH_PATTERN, { message: 'Tháng phải có dạng YYYY-MM, ví dụ 2026-10.' })
  month?: string;
}

export class ListExpensesQuery extends MonthQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Lọc theo người trả' })
  @IsOptional()
  @IsUUID('all', { message: 'payerId không hợp lệ.' })
  payerId?: string;

  @ApiPropertyOptional({ enum: ExpenseCategory, enumName: 'ExpenseCategory' })
  @IsOptional()
  @IsEnum(ExpenseCategory, { message: 'Danh mục không hợp lệ.' })
  category?: ExpenseCategory;

  @ApiPropertyOptional({ description: 'Tìm theo tên khoản chi hoặc tên người trả' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  q?: string;
}

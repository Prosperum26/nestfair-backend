import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ExpenseCategory } from '../../../generated/prisma/enums.js';

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class MonthQuery {
  @ApiPropertyOptional({ example: '2026-10', description: 'Month in Vietnam time (YYYY-MM). Defaults to the current month.' })
  @IsOptional()
  @Matches(MONTH_PATTERN, { message: 'Tháng phải có dạng YYYY-MM, ví dụ 2026-10.' })
  month?: string;
}

export class ListExpensesQuery extends MonthQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only expenses paid up front by this user.' })
  @IsOptional()
  @IsUUID('all', { message: 'payerId không hợp lệ.' })
  payerId?: string;

  @ApiPropertyOptional({ enum: ExpenseCategory, enumName: 'ExpenseCategory', description: 'Only expenses of this category.' })
  @IsOptional()
  @IsEnum(ExpenseCategory, { message: 'Danh mục không hợp lệ.' })
  category?: ExpenseCategory;

  @ApiPropertyOptional({ maxLength: 80, description: 'Case-insensitive search in the expense title or the payer\'s name.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  q?: string;
}

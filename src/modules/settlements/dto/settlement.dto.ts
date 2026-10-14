import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { SettlementStatus } from '../../../generated/prisma/enums.js';
import { UserBriefDto } from '../../expenses/dto/expense-response.dto.js';
import { MAX_AMOUNT } from '../../expenses/dto/create-expense.dto.js';
import { MonthQuery } from '../../expenses/dto/list-expenses.query.js';

export class CreateSettlementDto {
  @ApiProperty({ format: 'uuid', description: 'Người nhận tiền. Người chuyển luôn là bạn (lấy từ đăng nhập).' })
  @IsUUID('all', { message: 'toUserId không hợp lệ.' })
  toUserId: string;

  @ApiProperty({ minimum: 1, example: 170_000, description: 'Số nguyên VNĐ, không vượt số bạn đang nợ và số người nhận đang được nhận' })
  @IsInt({ message: 'Số tiền phải là số nguyên VNĐ.' })
  @Min(1, { message: 'Số tiền phải lớn hơn 0.' })
  @Max(MAX_AMOUNT, { message: 'Số tiền quá lớn.' })
  amount: number;

  @ApiPropertyOptional({ description: 'URL bill trả về từ POST /settlements/proof' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Ảnh bill không hợp lệ.' })
  proofUrl?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200, { message: 'Ghi chú tối đa 200 ký tự.' })
  note?: string;
}

export class ListSettlementsQuery extends MonthQuery {
  @ApiPropertyOptional({ enum: ['all', 'mine'], default: 'all', description: 'mine = chỉ giao dịch bạn chuyển hoặc nhận' })
  @IsOptional()
  @IsIn(['all', 'mine'], { message: 'scope phải là all hoặc mine.' })
  scope?: 'all' | 'mine';
}

export class SettlementDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: UserBriefDto }) from: UserBriefDto;
  @ApiProperty({ type: UserBriefDto }) to: UserBriefDto;
  @ApiProperty({ description: 'Số nguyên VNĐ' }) amount: number;
  @ApiProperty({ enum: SettlementStatus, enumName: 'SettlementStatus' }) status: SettlementStatus;
  @ApiProperty({ type: String, nullable: true }) proofUrl: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: Date, nullable: true }) confirmedAt: Date | null;
}

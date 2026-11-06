import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { SettlementStatus } from '../../../generated/prisma/enums.js';
import { UserBriefDto } from '../../expenses/dto/expense-response.dto.js';
import { MAX_AMOUNT } from '../../expenses/dto/create-expense.dto.js';
import { MonthQuery } from '../../expenses/dto/list-expenses.query.js';

export class CreateSettlementDto {
  @ApiProperty({ format: 'uuid', description: 'User id of the member who receives the money. The payer is always the caller, taken from the access token. Cannot be the caller.' })
  @IsUUID('all', { message: 'toUserId không hợp lệ.' })
  toUserId: string;

  @ApiProperty({
    minimum: 1,
    maximum: MAX_AMOUNT,
    example: 170_000,
    description: 'Amount transferred, in integer VND. It cannot exceed what the caller currently owes the receiver, nor what the receiver is currently owed.',
  })
  @IsInt({ message: 'Số tiền phải là số nguyên VNĐ.' })
  @Min(1, { message: 'Số tiền phải lớn hơn 0.' })
  @Max(MAX_AMOUNT, { message: 'Số tiền quá lớn.' })
  amount: number;

  @ApiPropertyOptional({ description: 'HTTPS URL of the transfer screenshot returned by POST /houses/{houseId}/settlements/proof. Other URLs are refused with `PROOF_URL_INVALID`.' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Ảnh bill không hợp lệ.' })
  proofUrl?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Free-text note to the receiver (up to 200 characters).' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200, { message: 'Ghi chú tối đa 200 ký tự.' })
  note?: string;
}

export class ListSettlementsQuery extends MonthQuery {
  @ApiPropertyOptional({ enum: ['all', 'mine'], default: 'all', description: '`all` lists every settlement of the house; `mine` keeps only those the caller paid or received.' })
  @IsOptional()
  @IsIn(['all', 'mine'], { message: 'scope phải là all hoặc mine.' })
  scope?: 'all' | 'mine';
}

export class SettlementDto {
  @ApiProperty({ format: 'uuid', description: 'Settlement id.' })
  id: string;

  @ApiProperty({ type: UserBriefDto, description: 'The member who paid.' })
  from: UserBriefDto;

  @ApiProperty({ type: UserBriefDto, description: 'The member who receives the money.' })
  to: UserBriefDto;

  @ApiProperty({ description: 'Amount in integer VND.' })
  amount: number;

  @ApiProperty({ enum: SettlementStatus, enumName: 'SettlementStatus', description: '`PENDING` = reported by the payer, waiting for the receiver (not yet counted in balances); `CONFIRMED` = receiver confirmed, balances updated; `CANCELLED` = withdrawn by the payer or rejected by the receiver.' })
  status: SettlementStatus;

  @ApiProperty({ type: String, nullable: true, description: 'URL of the transfer screenshot, or null.' })
  proofUrl: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Note from the payer, or null.' })
  note: string | null;

  @ApiProperty({ description: 'When the transfer was reported (ISO 8601 UTC).' })
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true, description: 'When the receiver confirmed (ISO 8601 UTC); null until then.' })
  confirmedAt: Date | null;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const DEFAULT_MESSAGE_PAGE = 30;
export const MAX_MESSAGE_PAGE = 50;

export class ListMessagesQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Chat thread to read. Omit it to read the caller\'s most recent thread in this house.' })
  @IsOptional()
  @IsUUID('all', { message: 'threadId không hợp lệ.' })
  threadId?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Pagination cursor taken from `nextCursor` of the previous response.' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'cursor không hợp lệ.' })
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_MESSAGE_PAGE, default: DEFAULT_MESSAGE_PAGE, description: 'Messages per page (1-50).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên.' })
  @Min(1, { message: 'limit tối thiểu là 1.' })
  @Max(MAX_MESSAGE_PAGE, { message: 'limit tối đa là ' + MAX_MESSAGE_PAGE + '.' })
  limit?: number;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const DEFAULT_MESSAGE_PAGE = 30;
export const MAX_MESSAGE_PAGE = 50;

export class ListMessagesQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Thread cần đọc; bỏ trống thì lấy thread mới nhất của bạn trong nhà này' })
  @IsOptional()
  @IsUUID('all', { message: 'threadId không hợp lệ.' })
  threadId?: string;

  @ApiPropertyOptional({ description: 'Con trỏ phân trang lấy từ `nextCursor` của lần gọi trước' })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'cursor không hợp lệ.' })
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_MESSAGE_PAGE, default: DEFAULT_MESSAGE_PAGE, description: 'Số tin mỗi trang (1–50)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên.' })
  @Min(1, { message: 'limit tối thiểu là 1.' })
  @Max(MAX_MESSAGE_PAGE, { message: 'limit tối đa là ' + MAX_MESSAGE_PAGE + '.' })
  limit?: number;
}

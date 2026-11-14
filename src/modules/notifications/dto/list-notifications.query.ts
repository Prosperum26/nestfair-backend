import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const DEFAULT_NOTIFICATION_PAGE = 30;
export const MAX_NOTIFICATION_PAGE = 100;

export class HouseFilterQuery {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only notifications of this house. It only filters the caller\'s own notifications, so it cannot expose another house.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'houseId không hợp lệ.' })
  houseId?: string;
}

export class ListNotificationsQuery extends HouseFilterQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_NOTIFICATION_PAGE, default: DEFAULT_NOTIFICATION_PAGE, description: 'Maximum number of notifications to return (1-100), newest first.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên.' })
  @Min(1, { message: 'limit tối thiểu là 1.' })
  @Max(MAX_NOTIFICATION_PAGE, { message: 'limit tối đa là ' + MAX_NOTIFICATION_PAGE + '.' })
  limit?: number;
}

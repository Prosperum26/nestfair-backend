import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { HouseFilterQuery, ListNotificationsQuery } from './dto/list-notifications.query.js';
import { MarkAllReadDto, NotificationDto, NotificationListDto } from './dto/notification.dto.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Hộp thông báo cá nhân (chuông). User-scoped như reminders: mọi route chỉ đọc / đánh dấu thông báo của CHÍNH
 * người gọi (userId từ JWT). `houseId` trong query chỉ lọc trên các dòng của chính họ nên không lộ nhà khác.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@ApiErrors(401)
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my notifications',
    description:
      'Returns the caller\'s own notifications, newest first, together with the number of unread ones. Notifications are personal and never visible to housemates. ' +
      'Pass `houseId` to show one house only. Clients refresh this list when they receive the existing socket events `expense:new`, `settlement:requested` or `reminder:due`. Read-only.',
  })
  @ApiOkResponse({ type: NotificationListDto, description: 'The caller\'s notifications and unread count.' })
  @ApiErrors([400, '`houseId` is not a UUID, or `limit` is out of range.'])
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQuery): Promise<NotificationListDto> {
    return this.notifications.list(user.id, query);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark all my notifications as read',
    description:
      'Marks every unread notification of the caller as read, optionally only those of one house (`houseId`). Returns how many were changed; calling it again returns 0. It never touches another user\'s notifications.',
  })
  @ApiOkResponse({ type: MarkAllReadDto, description: 'Number of notifications switched to read.' })
  @ApiErrors([400, '`houseId` is not a UUID.'])
  markAllRead(@CurrentUser() user: AuthUser, @Query() query: HouseFilterQuery): Promise<MarkAllReadDto> {
    return this.notifications.markAllRead(user.id, query.houseId);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark one notification as read',
    description:
      'Marks one of the caller\'s notifications as read and returns it. Calling it again keeps the first `readAt`. A notification that belongs to someone else is reported as not found, so its existence is not revealed.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Notification id.' })
  @ApiOkResponse({ type: NotificationDto, description: 'The notification, now read.' })
  @ApiErrors([400, '`id` is not a UUID.'], [404, 'NOTIFICATION_NOT_FOUND: no such notification for the caller.'])
  markRead(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<NotificationDto> {
    return this.notifications.markRead(user.id, id);
  }
}

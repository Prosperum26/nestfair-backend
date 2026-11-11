import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Hộp thông báo cá nhân. Module khác (expenses, settlements, scheduler) import để gọi
 * `NotificationsService.notify` ngay trong transaction nghiệp vụ của mình.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

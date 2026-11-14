import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { SettlementActionsService } from './settlement-actions.service.js';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  imports: [AuthModule, HousesModule, ExpensesModule, UploadsModule, NotificationsModule],
  controllers: [SettlementsController],
  providers: [SettlementsService, SettlementActionsService],
})
export class SettlementsModule {}

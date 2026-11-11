import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from './expenses.service.js';
import { LedgerService } from './ledger.service.js';

/** Export LedgerService để module thanh toán (và sau này rời nhà) đọc số dư ròng. */
@Module({
  imports: [AuthModule, HousesModule, UploadsModule, NotificationsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, LedgerService],
  exports: [LedgerService],
})
export class ExpensesModule {}

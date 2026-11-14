import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ChoresModule } from '../chores/chores.module.js';
import { EventsModule } from '../events/events.module.js';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { SwapsModule } from '../swaps/swaps.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { DissolveService } from './dissolve.service.js';
import { MembershipController } from './membership.controller.js';
import { MembershipService } from './membership.service.js';

/**
 * Rời nhà / xóa thành viên / chuyển quyền. Tách khỏi HousesModule vì cần sổ chi, đổi ca và lịch trực,
 * mà các module đó lại import HousesModule (để dùng guard): đặt ở đây tránh vòng import.
 */
@Module({
  imports: [AuthModule, HousesModule, ExpensesModule, SwapsModule, ChoresModule, ActivityModule, EventsModule, UploadsModule],
  controllers: [MembershipController],
  providers: [MembershipService, DissolveService],
})
export class MembershipModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/throttle/app-throttler.guard.js';
import { throttlerOptions } from './common/throttle/throttle.config.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AssistantModule } from './modules/assistant/assistant.module.js';
import { validateEnv } from './config/env.validation.js';
import { ActivityModule } from './modules/activity/activity.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChoresModule } from './modules/chores/chores.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { ReceiptsModule } from './modules/receipts/receipts.module.js';
import { RemindersModule } from './modules/reminders/reminders.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { HousesModule } from './modules/houses/houses.module.js';
import { ListingModule } from './modules/listing/listing.module.js';
import { MembershipModule } from './modules/membership/membership.module.js';
import { SchedulerModule } from './modules/scheduler/scheduler.module.js';
import { SwapsModule } from './modules/swaps/swaps.module.js';
import { SettlementsModule } from './modules/settlements/settlements.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { WheelModule } from './modules/wheel/wheel.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    UsersModule,
    HousesModule,
    ChoresModule,
    WheelModule,
    SwapsModule,
    ExpensesModule,
    ReceiptsModule,
    RemindersModule,
    NotificationsModule,
    AssistantModule,
    SettlementsModule,
    ListingModule,
    MembershipModule,
    EventsModule,
    ActivityModule,
    ScheduleModule.forRoot(),
    // Giới hạn tần suất toàn cục theo IP (AppThrottlerGuard bên dưới); route nhạy cảm ghi đè bằng @Throttle. Bỏ qua khi test.
    ThrottlerModule.forRoot(throttlerOptions),
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule {}

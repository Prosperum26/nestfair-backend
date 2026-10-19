import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnv } from './config/env.validation.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChoresModule } from './modules/chores/chores.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { HousesModule } from './modules/houses/houses.module.js';
import { SchedulerModule } from './modules/scheduler/scheduler.module.js';
import { SettlementsModule } from './modules/settlements/settlements.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    UsersModule,
    HousesModule,
    ChoresModule,
    ExpensesModule,
    SettlementsModule,
    EventsModule,
    ScheduleModule.forRoot(),
    // Giới hạn tần suất cho check-in / duyệt / khiếu nại (ThrottlerGuard gắn riêng trên các route đó). Bỏ qua khi test.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 20 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    SchedulerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

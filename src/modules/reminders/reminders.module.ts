import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';

/**
 * Nhắc nhở việc cá nhân (Issue #12). User-scoped như UsersModule: chỉ cần JwtAuthGuard, userId lấy
 * từ JWT; houseId chỉ xuất hiện trong body khi tạo và service tự kiểm tra membership (chống IDOR).
 */
@Module({
  imports: [AuthModule],
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}

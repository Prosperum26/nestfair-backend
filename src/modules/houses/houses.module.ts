import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HouseMemberGuard } from './guards/house-member.guard.js';
import { HouseRolesGuard } from './guards/house-roles.guard.js';
import { HousesController } from './houses.controller.js';
import { HousesService } from './houses.service.js';

/** Module khác (chores, expenses…) import HousesModule để dùng HouseMemberGuard / HouseRolesGuard. */
@Module({
  imports: [AuthModule],
  controllers: [HousesController],
  providers: [HousesService, HouseMemberGuard, HouseRolesGuard],
  exports: [HouseMemberGuard, HouseRolesGuard],
})
export class HousesModule {}

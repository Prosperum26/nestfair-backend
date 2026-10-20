import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ChoresModule } from '../chores/chores.module.js';
import { HouseWheelController, WheelSpinsController } from './wheel.controller.js';
import { WheelService } from './wheel.service.js';

@Module({
  imports: [AuthModule, ChoresModule],
  controllers: [HouseWheelController, WheelSpinsController],
  providers: [WheelService],
  exports: [WheelService],
})
export class WheelModule {}

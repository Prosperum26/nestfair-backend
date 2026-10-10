import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { ChoresController } from './chores.controller.js';
import { ChoresService } from './chores.service.js';

@Module({
  imports: [AuthModule, HousesModule],
  controllers: [ChoresController],
  providers: [ChoresService],
})
export class ChoresModule {}

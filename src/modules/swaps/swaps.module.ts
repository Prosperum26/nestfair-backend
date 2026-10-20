import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { SwapAssignmentController } from './swaps.controller.js';
import { SwapOptionsService } from './swap-options.service.js';
import { SwapValidator } from './swap-validator.js';

@Module({
  imports: [AuthModule, HousesModule],
  controllers: [SwapAssignmentController],
  providers: [SwapValidator, SwapOptionsService],
  exports: [SwapValidator],
})
export class SwapsModule {}

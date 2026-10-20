import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventsModule } from '../events/events.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { SwapActionsController, SwapAssignmentController, SwapsHouseController } from './swaps.controller.js';
import { SwapOptionsService } from './swap-options.service.js';
import { SwapValidator } from './swap-validator.js';
import { SwapsService } from './swaps.service.js';

@Module({
  imports: [AuthModule, HousesModule, EventsModule, ActivityModule],
  controllers: [SwapAssignmentController, SwapsHouseController, SwapActionsController],
  providers: [SwapValidator, SwapOptionsService, SwapsService],
  exports: [SwapValidator, SwapsService],
})
export class SwapsModule {}

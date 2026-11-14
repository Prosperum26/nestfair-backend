import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { AuditService } from '../chores/audit.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventsModule } from '../events/events.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { ChoreDebtActionsController, ChoreDebtsController } from './chore-debts.controller.js';
import { PaybackService } from './payback.service.js';
import { SwapActionsController, SwapAssignmentController, SwapsHouseController } from './swaps.controller.js';
import { ChoreDebtService } from './chore-debt.service.js';
import { SwapEscalationService } from './swap-escalation.service.js';
import { SwapLifecycleService } from './swap-lifecycle.service.js';
import { SwapOptionsService } from './swap-options.service.js';
import { SwapValidator } from './swap-validator.js';
import { SwapsService } from './swaps.service.js';

@Module({
  imports: [AuthModule, HousesModule, EventsModule, ActivityModule],
  controllers: [SwapAssignmentController, SwapsHouseController, SwapActionsController, ChoreDebtsController, ChoreDebtActionsController],
  providers: [SwapValidator, SwapOptionsService, SwapsService, SwapLifecycleService, AuditService, ChoreDebtService, PaybackService, SwapEscalationService],
  exports: [SwapValidator, SwapsService, SwapLifecycleService, ChoreDebtService, PaybackService, SwapEscalationService],
})
export class SwapsModule {}

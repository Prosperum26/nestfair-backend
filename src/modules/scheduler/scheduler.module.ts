import { Module } from '@nestjs/common';
import { ChoresModule } from '../chores/chores.module.js';
import { SwapsModule } from '../swaps/swaps.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ChoreCronService } from './chore-cron.service.js';
import { SwapCronService } from './swap-cron.service.js';

@Module({
  imports: [ChoresModule, UploadsModule, SwapsModule],
  providers: [ChoreCronService, SwapCronService],
})
export class SchedulerModule {}

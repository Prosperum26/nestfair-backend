import { Module } from '@nestjs/common';
import { ChoresModule } from '../chores/chores.module.js';
import { ChoreCronService } from './chore-cron.service.js';

@Module({
  imports: [ChoresModule],
  providers: [ChoreCronService],
})
export class SchedulerModule {}

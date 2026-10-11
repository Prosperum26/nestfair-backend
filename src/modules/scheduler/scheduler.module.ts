import { Module } from '@nestjs/common';
import { ChoresModule } from '../chores/chores.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ChoreCronService } from './chore-cron.service.js';

@Module({
  imports: [ChoresModule, UploadsModule],
  providers: [ChoreCronService],
})
export class SchedulerModule {}

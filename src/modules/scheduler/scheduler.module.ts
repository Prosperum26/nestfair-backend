import { Module } from '@nestjs/common';
import { ChoresModule } from '../chores/chores.module.js';
import { SwapsModule } from '../swaps/swaps.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ChoreCronService } from './chore-cron.service.js';
import { SwapCronService } from './swap-cron.service.js';
import { ChoreTodayDigestSource, DIGEST_SOURCES, ReminderCronService, type DigestSource } from './reminder-cron.service.js';

@Module({
  imports: [ChoresModule, UploadsModule, SwapsModule],
  providers: [
    ChoreCronService,
    SwapCronService,
    ChoreTodayDigestSource,
    // Quyết định D6: nguồn bản tin hằng ngày là mảng Inject-able; module sau (đổi ca) chỉ cần
    // thêm provider nguồn của mình vào đây, không sửa ReminderCronService.
    { provide: DIGEST_SOURCES, useFactory: (choreToday: DigestSource) => [choreToday], inject: [ChoreTodayDigestSource] },
    ReminderCronService,
  ],
})
export class SchedulerModule {}

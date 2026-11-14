import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ActivityController } from './activity.controller.js';
import { ActivityService } from './activity.service.js';

/** Global để module nghiệp vụ (việc nhà, vòng quay, chi tiêu, đổi ca…) chỉ cần inject ActivityService. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}

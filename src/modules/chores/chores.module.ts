import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { SwapsModule } from '../swaps/swaps.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { AbsencesController, BreaksController, ChoreAuditController } from './absences.controller.js';
import { AbsencesService } from './absences.service.js';
import { BreaksService } from './breaks.service.js';
import { AssignmentActionsController } from './assignment-actions.controller.js';
import { AssignmentsController } from './assignments.controller.js';
import { AssignmentsService } from './assignments.service.js';
import { CheckinService } from './checkin.service.js';
import { VerifyService } from './verify.service.js';
import { AuditService } from './audit.service.js';
import { ScheduleService } from './schedule.service.js';
import { ChoreSettingsController } from './chore-settings.controller.js';
import { ChoreSettingsService } from './chore-settings.service.js';
import { ChoresController } from './chores.controller.js';
import { ChoresService } from './chores.service.js';

@Module({
  imports: [AuthModule, HousesModule, UploadsModule, SwapsModule],
  controllers: [
    ChoresController,
    AssignmentsController,
    AssignmentActionsController,
    ChoreSettingsController,
    AbsencesController,
    BreaksController,
    ChoreAuditController,
  ],
  providers: [ChoresService, ChoreSettingsService, AssignmentsService, CheckinService, VerifyService, ScheduleService, AuditService, AbsencesService, BreaksService],
  exports: [ScheduleService, AuditService],
})
export class ChoresModule {}

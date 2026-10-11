import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { AssignmentActionsController } from './assignment-actions.controller.js';
import { AssignmentsController } from './assignments.controller.js';
import { AssignmentsService } from './assignments.service.js';
import { AuditService } from './audit.service.js';
import { ChoreScheduleService } from './chore-schedule.service.js';
import { ScheduleService } from './schedule.service.js';
import { ChoresController } from './chores.controller.js';
import { ChoresService } from './chores.service.js';

@Module({
  imports: [AuthModule, HousesModule, UploadsModule],
  controllers: [
    ChoresController,
    AssignmentsController,
    AssignmentActionsController,
  ],
  providers: [ChoresService, AssignmentsService, ChoreScheduleService, ScheduleService, AuditService],
  exports: [ChoreScheduleService, ScheduleService, AuditService],
})
export class ChoresModule {}

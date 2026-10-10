import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HousesModule } from '../houses/houses.module.js';
import { AssignmentsController } from './assignments.controller.js';
import { AssignmentsService } from './assignments.service.js';
import { ChoreScheduleService } from './chore-schedule.service.js';
import { ChoresController } from './chores.controller.js';
import { ChoresService } from './chores.service.js';

@Module({
  imports: [AuthModule, HousesModule],
  controllers: [ChoresController, AssignmentsController],
  providers: [ChoresService, AssignmentsService, ChoreScheduleService],
  exports: [ChoreScheduleService],
})
export class ChoresModule {}

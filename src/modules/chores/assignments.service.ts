import { BadRequestException, Injectable } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { toAssignmentDto } from './assignment.mapper.js';
import { ChoreScheduleService } from './chore-schedule.service.js';
import type { AssignmentDto, ShuffleResultDto } from './dto/assignment-response.dto.js';
import { isValidWeekKey, weekKeyOf } from './week.js';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly schedule: ChoreScheduleService,
    private readonly events: EventsService,
  ) {}

  async list(houseId: string, weekKey?: string): Promise<AssignmentDto[]> {
    const key = this.resolveWeek(weekKey);
    const rows = await this.schedule.fetchWeek(houseId, key);
    return rows.map(toAssignmentDto);
  }

  async shuffle(houseId: string, weekKey?: string): Promise<ShuffleResultDto> {
    const key = this.resolveWeek(weekKey);
    if (key < weekKeyOf(new Date())) {
      throw new BadRequestException('Không thể xếp lại lịch của tuần đã qua.');
    }
    const { assignments, relaxed } = await this.schedule.generateWeek(houseId, key, 'SHUFFLE');
    this.events.emitToHouse(houseId, 'chore:shuffled', { weekKey: key, relaxed });
    return { assignments, relaxed };
  }

  private resolveWeek(weekKey?: string): string {
    if (weekKey === undefined) return weekKeyOf(new Date());
    if (!isValidWeekKey(weekKey)) {
      throw new BadRequestException('Tuần không hợp lệ, định dạng đúng là 2026-W41.');
    }
    return weekKey;
  }
}

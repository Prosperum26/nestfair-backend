import { ApiProperty } from '@nestjs/swagger';
import { ChoreFrequency, RotationMode } from '../../../generated/prisma/enums.js';

export class ChoreDto {
  @ApiProperty({ format: 'uuid', description: 'Chore id.' })
  id: string;

  @ApiProperty({ example: 'Take out the trash', description: 'Chore name.' })
  title: string;

  @ApiProperty({ minimum: 1, maximum: 5, description: 'Effort weight, 1 (light) to 5 (heavy).' })
  weight: number;

  @ApiProperty({ enum: ChoreFrequency, enumName: 'ChoreFrequency', description: 'DAILY, WEEKLY or ADHOC.' })
  frequency: ChoreFrequency;

  @ApiProperty({ type: [Number], example: [1, 4], description: 'ISO weekdays when the chore occurs: 1 = Monday ... 7 = Sunday.' })
  recurrenceDays: number[];

  @ApiProperty({ example: '21:00', description: 'Deadline time of day (HH:mm, house time zone).' })
  dueTime: string;

  @ApiProperty({ enum: RotationMode, enumName: 'RotationMode', description: 'PER_OCCURRENCE or WEEK_BLOCK.' })
  rotationMode: RotationMode;

  @ApiProperty({ description: 'PER_OCCURRENCE only: the same person does not repeat the chore within this many occurrences.' })
  occurrenceGap: number;

  @ApiProperty({ description: 'false when the chore is paused and no longer scheduled.' })
  isActive: boolean;
}

export class ChoreSettingsDto {
  @ApiProperty({ minimum: 1, maximum: 24, description: 'Grace period in hours after the deadline during which a photo can still be submitted (marked late).' })
  choreGraceHours: number;

  @ApiProperty({ minimum: 1, maximum: 6, description: 'Maximum number of assignments one person may receive on a single day.' })
  maxSlotsPerPersonPerDay: number;
}

import { ApiProperty } from '@nestjs/swagger';
import { ChoreFrequency, RotationMode } from '../../../generated/prisma/enums.js';

export class ChoreDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) weight: number;
  @ApiProperty({ enum: ChoreFrequency, enumName: 'ChoreFrequency' }) frequency: ChoreFrequency;
  @ApiProperty({ type: [Number], example: [1, 4], description: 'ISO 1 = Thứ Hai … 7 = Chủ Nhật' })
  recurrenceDays: number[];
  @ApiProperty({ example: '21:00' }) dueTime: string;
  @ApiProperty({ enum: RotationMode, enumName: 'RotationMode' }) rotationMode: RotationMode;
  @ApiProperty() occurrenceGap: number;
  @ApiProperty() isActive: boolean;
}

export class ChoreSettingsDto {
  @ApiProperty({ minimum: 1, maximum: 24, description: 'Ân hạn nộp muộn (giờ) sau hạn' }) choreGraceHours: number;
  @ApiProperty({ minimum: 1, maximum: 6, description: 'Số ca tối đa một người nhận trong một ngày' })
  maxSlotsPerPersonPerDay: number;
}

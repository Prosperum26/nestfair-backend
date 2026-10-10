import { ApiProperty } from '@nestjs/swagger';
import { ChoreFrequency } from '../../../generated/prisma/enums.js';

export class ChoreDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() title: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) weight: number;
  @ApiProperty({ enum: ChoreFrequency, enumName: 'ChoreFrequency' })
  frequency: ChoreFrequency;
  @ApiProperty() isActive: boolean;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateChoreSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 24, description: 'Grace period in hours after the deadline during which a photo can still be submitted.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Ân hạn phải là số giờ nguyên.' })
  @Min(1, { message: 'Ân hạn từ 1 đến 24 giờ.' })
  @Max(24, { message: 'Ân hạn từ 1 đến 24 giờ.' })
  choreGraceHours?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 6, description: 'Maximum assignments per person per day (1-6).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số ca phải là số nguyên.' })
  @Min(1, { message: 'Số ca mỗi ngày từ 1 đến 6.' })
  @Max(6, { message: 'Số ca mỗi ngày từ 1 đến 6.' })
  maxSlotsPerPersonPerDay?: number;
}

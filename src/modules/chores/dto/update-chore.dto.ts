import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateChoreDto } from './create-chore.dto.js';

export class UpdateChoreDto extends PartialType(CreateChoreDto) {
  @ApiPropertyOptional({ description: 'false = tạm ngưng: không xếp lịch, ca TODO tương lai bị hủy' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

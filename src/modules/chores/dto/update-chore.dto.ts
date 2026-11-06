import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateChoreDto } from './create-chore.dto.js';

export class UpdateChoreDto extends PartialType(CreateChoreDto) {
  @ApiPropertyOptional({ description: 'false pauses the chore: it is no longer scheduled and its future TODO assignments are cancelled. true resumes it.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ActivityDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'chore.submitted', description: 'Client ghép câu từ type + params' })
  type: string;

  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'null = hệ thống (cron)' })
  actorUserId: string | null;

  @ApiProperty({ example: 'Phạm Ngọc Mai', description: 'Tên chụp lúc xảy ra' })
  actorName: string;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { choreTitle: 'Rửa chén tối' } })
  params: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;
}

export class ListActivityQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên.' })
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'Cuộn thêm: các mục cũ hơn mốc này (ISO)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'before phải là thời điểm ISO hợp lệ.' })
  before?: Date;

  @ApiPropertyOptional({ description: 'Bù sau reconnect: các mục mới hơn mốc này (ISO), tối đa 100' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'since phải là thời điểm ISO hợp lệ.' })
  since?: Date;
}

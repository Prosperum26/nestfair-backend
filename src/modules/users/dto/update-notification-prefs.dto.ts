import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Chỉ khóa có gửi mới đổi, khóa còn lại giữ nguyên. */
export class UpdateNotificationPrefsDto {
  @ApiPropertyOptional({ description: 'Notify when a new expense that includes the user is added.' })
  @IsOptional()
  @IsBoolean({ message: 'expenseCreated phải là true hoặc false.' })
  expenseCreated?: boolean;

  @ApiPropertyOptional({ description: 'Daily chore digest at 08:00 listing the user\'s assignments for the day.' })
  @IsOptional()
  @IsBoolean({ message: 'choreDigest phải là true hoặc false.' })
  choreDigest?: boolean;

  @ApiPropertyOptional({ description: 'Notify when someone pays the user back.' })
  @IsOptional()
  @IsBoolean({ message: 'debtPaid phải là true hoặc false.' })
  debtPaid?: boolean;
}

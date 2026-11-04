import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Chỉ khóa có gửi mới đổi, khóa còn lại giữ nguyên. */
export class UpdateNotificationPrefsDto {
  @ApiPropertyOptional({ description: 'Báo khi có khoản chi mới tính tên bạn.' })
  @IsOptional()
  @IsBoolean({ message: 'expenseCreated phải là true hoặc false.' })
  expenseCreated?: boolean;

  @ApiPropertyOptional({ description: 'Bản tin việc nhà lúc 08:00 cho ca của bạn trong ngày.' })
  @IsOptional()
  @IsBoolean({ message: 'choreDigest phải là true hoặc false.' })
  choreDigest?: boolean;

  @ApiPropertyOptional({ description: 'Báo khi có người trả nợ cho bạn.' })
  @IsOptional()
  @IsBoolean({ message: 'debtPaid phải là true hoặc false.' })
  debtPaid?: boolean;
}

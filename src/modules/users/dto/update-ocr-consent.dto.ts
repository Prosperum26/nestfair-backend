import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateOcrConsentDto {
  @ApiProperty({
    description:
      'true = đồng ý gửi ảnh hóa đơn tới Google Gemini để đọc; false = rút lại. Chưa đồng ý thì quét hóa đơn bị chặn (403 OCR_CONSENT_REQUIRED).',
  })
  @IsBoolean({ message: 'enabled phải là true hoặc false.' })
  enabled: boolean;
}

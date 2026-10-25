import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAssistantConsentDto {
  @ApiProperty({
    description:
      'true = đồng ý gửi nội dung chat tới Google Gemini để Trợ lý AI trả lời; false = rút lại. Đồng ý trợ lý tách riêng với đồng ý OCR.',
  })
  @IsBoolean({ message: 'enabled phải là true hoặc false.' })
  enabled: boolean;
}

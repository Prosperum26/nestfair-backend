import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAssistantConsentDto {
  @ApiProperty({
    description:
      'true = consent to send chat text to Google Gemini so the AI assistant can answer; false = withdraw. This consent is separate from the receipt-scan (OCR) consent.',
  })
  @IsBoolean({ message: 'enabled phải là true hoặc false.' })
  enabled: boolean;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateOcrConsentDto {
  @ApiProperty({
    description:
      'true = consent to send receipt photos to Google Gemini for reading; false = withdraw. Without consent, receipt scanning is blocked with 403 `OCR_CONSENT_REQUIRED`.',
  })
  @IsBoolean({ message: 'enabled phải là true hoặc false.' })
  enabled: boolean;
}

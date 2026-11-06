import { ApiProperty } from '@nestjs/swagger';

/** Public profile of a user. Documentation-only class; the real payload comes from `publicUserSelect`. */
export class PublicUserDto {
  @ApiProperty({ format: 'uuid', description: 'User id.' })
  id: string;

  @ApiProperty({ example: 'hung.tm@student.uit.edu.vn', description: 'Sign-in email (lower-case).' })
  email: string;

  @ApiProperty({ example: 'Minh Hung Tran', description: 'Display name.' })
  fullName: string;

  @ApiProperty({ type: String, nullable: true, example: '0901234567', description: 'Vietnamese mobile number, or null when not set.' })
  phone: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '970407',
    description: 'Napas BIN (6 digits) of the bank where the user receives money, used to build VietQR codes. Always set together with `bankAccount`.',
  })
  bankBin: string | null;

  @ApiProperty({ type: String, nullable: true, example: '19036780123', description: 'Bank account number (6-19 digits), or null.' })
  bankAccount: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'URL of the avatar image, or null.' })
  avatarUrl: string | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'When the user consented to send receipt photos to Google Gemini; null means no consent yet and receipt scanning is blocked.',
  })
  ocrConsentAt: Date | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'When the user consented to send assistant chat text to Google Gemini; null means no consent yet and the chat is blocked.',
  })
  assistantConsentAt: Date | null;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: { type: 'boolean' },
    example: { expenseCreated: true, choreDigest: true, debtPaid: false },
    description: 'Notification switches (`expenseCreated`, `choreDigest`, `debtPaid`). null means never customized, which is treated as all on.',
  })
  notificationPrefs: unknown;

  @ApiProperty({ description: 'Account creation time (ISO 8601 UTC).' })
  createdAt: Date;
}

export class AuthConfigDto {
  @ApiProperty({ description: 'true when the server has Google OAuth credentials configured, so Google sign-in is available.' })
  googleEnabled: boolean;
}

export class AuthResponseDto {
  @ApiProperty({
    description: 'JWT access token valid for 15 minutes. Send it as `Authorization: Bearer <token>`.',
  })
  accessToken: string;

  @ApiProperty({ type: PublicUserDto, description: 'The signed-in user.' })
  user: PublicUserDto;
}

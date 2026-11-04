import { ApiProperty } from '@nestjs/swagger';

/** Chỉ dùng cho Swagger; dữ liệu thật lấy theo publicUserSelect. */
export class PublicUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() email: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true, example: '970407' }) bankBin:
    string | null;
  @ApiProperty({ type: String, nullable: true }) bankAccount: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'Lúc người dùng đồng ý gửi ảnh hóa đơn tới Google Gemini; null = chưa đồng ý (quét OCR bị chặn).',
  })
  ocrConsentAt: Date | null;
  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'Lúc người dùng đồng ý gửi nội dung chat tới Google Gemini cho Trợ lý AI; null = chưa đồng ý (chat bị chặn).',
  })
  assistantConsentAt: Date | null;
  @ApiProperty({
    type: "object",
    nullable: true,
    additionalProperties: { type: "boolean" },
    example: { expenseCreated: true, choreDigest: true, debtPaid: false },
    description:
      "Công tắc thông báo (expenseCreated, choreDigest, debtPaid); null = chưa chỉnh, coi như bật hết.",
  })
  notificationPrefs: unknown;
  @ApiProperty() createdAt: Date;
}

export class AuthConfigDto {
  @ApiProperty({
    description: 'true khi backend đã cấu hình GOOGLE_CLIENT_ID + SECRET',
  })
  googleEnabled: boolean;
}

export class AuthResponseDto {
  @ApiProperty({
    description:
      'JWT access token, hạn 15 phút. Gửi qua header Authorization: Bearer.',
  })
  accessToken: string;

  @ApiProperty({ type: PublicUserDto })
  user: PublicUserDto;
}

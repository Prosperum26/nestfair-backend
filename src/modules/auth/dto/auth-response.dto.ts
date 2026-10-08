import { ApiProperty } from '@nestjs/swagger';

/** Chỉ dùng cho Swagger; dữ liệu thật lấy theo publicUserSelect. */
export class PublicUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() email: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true, example: '970407' }) bankBin: string | null;
  @ApiProperty({ type: String, nullable: true }) bankAccount: string | null;
  @ApiProperty({ type: String, nullable: true }) avatarUrl: string | null;
  @ApiProperty() createdAt: Date;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT access token, hạn 15 phút. Gửi qua header Authorization: Bearer.' })
  accessToken: string;

  @ApiProperty({ type: PublicUserDto })
  user: PublicUserDto;
}

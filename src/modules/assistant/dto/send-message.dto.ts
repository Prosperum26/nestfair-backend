import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class SendMessageDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Phiên chat (thread) hiện có; bỏ trống để mở phiên mới. Lịch sử gửi cho AI chỉ lấy trong thread này.' })
  @IsOptional()
  @IsUUID('all', { message: 'threadId không hợp lệ.' })
  threadId?: string;

  @ApiProperty({ example: 'Bồn cầu bị nghẹt, mình xử lý thế nào?', minLength: 1, maxLength: 1000, description: 'Tin nhắn gửi cho Trợ lý (đã trim, 1–1000 ký tự)' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 1000, { message: 'Tin nhắn cần từ 1 đến 1000 ký tự.' })
  content: string;
}

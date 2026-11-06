import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class SendMessageDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Existing chat thread to continue; omit it to start a new thread. Only the history of this thread is sent to the AI as context.' })
  @IsOptional()
  @IsUUID('all', { message: 'threadId không hợp lệ.' })
  threadId?: string;

  @ApiProperty({ example: 'The toilet is clogged, what should I do?', minLength: 1, maxLength: 1000, description: 'Message to the assistant (trimmed, 1-1000 characters).' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 1000, { message: 'Tin nhắn cần từ 1 đến 1000 ký tự.' })
  content: string;
}

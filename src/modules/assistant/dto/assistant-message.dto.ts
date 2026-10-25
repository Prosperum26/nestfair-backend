import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssistantCategory, AssistantRole } from '../../../generated/prisma/enums.js';
import type { SafeActionType } from '../assistant-schema.js';

const ACTION_TYPES: SafeActionType[] = ['CREATE_REMINDER', 'CREATE_ADHOC_TASK', 'DRAFT_EXPENSE'];

export class AssistantActionPayloadDto {
  @ApiPropertyOptional({ example: 'Đổ rác', description: 'Tiêu đề gợi ý cho nhắc nhở / việc / khoản chi' })
  title?: string;

  @ApiPropertyOptional({
    example: '2026-10-25T19:00:00+07:00',
    description: 'ISO 8601 kèm múi giờ +07:00, chỉ có với CREATE_REMINDER',
  })
  remindAt?: string;

  @ApiPropertyOptional({ example: 50_000, description: 'Số nguyên VNĐ, chỉ có với DRAFT_EXPENSE' })
  estimatedAmount?: number;
}

export class AssistantActionDto {
  @ApiProperty({ enum: ACTION_TYPES, enumName: 'AssistantActionType' })
  type: SafeActionType;

  @ApiProperty({ example: 'Nhắc tôi đổ rác tối nay' })
  label: string;

  @ApiProperty({ type: AssistantActionPayloadDto })
  payload: AssistantActionPayloadDto;

  @ApiProperty({
    description: 'Chỉ có nghĩa với CREATE_REMINDER: nút này đã được dùng để tạo nhắc nhở chưa (đã tạo thì UI khóa nút, chống bấm hai lần)',
  })
  done: boolean;
}

export class AssistantMessageDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid', description: 'Phiên chat mà tin này thuộc về' }) threadId: string;
  @ApiProperty({ enum: AssistantRole, enumName: 'AssistantRole' }) role: AssistantRole;
  @ApiProperty({ example: 'Bồn cầu bị nghẹt, mình xử lý thế nào?' }) content: string;
  @ApiProperty({ enum: AssistantCategory, enumName: 'AssistantCategory', nullable: true, description: 'Chỉ ASSISTANT có; null với tin USER' })
  category: AssistantCategory | null;
  @ApiProperty({ type: [AssistantActionDto], description: 'Chỉ là nút gợi ý: việc chỉ xảy ra khi người dùng bấm, Trợ lý không bao giờ tự ghi dữ liệu' })
  actions: AssistantActionDto[];
  @ApiProperty({ example: '2026-10-25T10:30:00.000Z' }) createdAt: string;
}

export class AssistantMessagesPageDto {
  @ApiProperty({ type: [AssistantMessageDto], description: 'Từ cũ đến mới trong trang' }) items: AssistantMessageDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Truyền lại khi lấy trang kế tiếp; null nếu còn đúng một trang' })
  nextCursor: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'Thread của các tin trả về; null khi chưa có tin nào' })
  threadId: string | null;
}

export class SendMessageResultDto {
  @ApiProperty({ format: 'uuid', description: 'Thread của phiên chat (mới nếu body không có threadId)' }) threadId: string;
  @ApiProperty({ type: AssistantMessageDto }) userMessage: AssistantMessageDto;
  @ApiProperty({ type: AssistantMessageDto, description: 'Câu trả lời (hoặc tin dự phòng khi AI lỗi / quá 10 giây)' })
  assistantMessage: AssistantMessageDto;
  @ApiProperty({ example: 29, description: 'Số tin còn lại trong hạn mức hôm nay (30 tin/người/ngày, giờ VN)' }) remaining: number;
}

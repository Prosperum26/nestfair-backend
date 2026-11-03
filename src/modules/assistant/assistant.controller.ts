import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { AssistantMessagesPageDto, SendMessageResultDto } from './dto/assistant-message.dto.js';
import { ListMessagesQuery } from './dto/list-messages.query.js';
import { SendMessageDto } from './dto/send-message.dto.js';
import { AssistantService } from './assistant.service.js';

/**
 * Trợ lý AI riêng tư theo người: mọi route chỉ đọc/ghi tin của CHÍNH người gọi (userId từ membership
 * đã xác thực, không tin houseId client gửi). Tin nhắn không bao giờ trả cho người khác.
 */
@ApiTags('assistant')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/assistant/messages')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get()
  @ApiOperation({
    summary: 'Đọc lịch sử chat với Trợ lý của CHÍNH MÌNH',
    description:
      'Chỉ trả tin nhắn của người gọi trong nhà này. `threadId` bỏ trống → thread mới nhất. ' +
      'Trang gồm `items` từ cũ đến mới, `nextCursor` truyền lại để lấy trang kế tiếp (phân trang theo createdAt + id). ' +
      'Không có API xóa lịch sử.',
  })
  @ApiOkResponse({ type: AssistantMessagesPageDto })
  list(@CurrentMembership() m: HouseMembership, @Query() query: ListMessagesQuery): Promise<AssistantMessagesPageDto> {
    return this.assistant.list(m, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Gửi tin cho Trợ lý AI và nhận câu trả lời',
    description:
      'Cần đã đồng ý gửi tin nhắn tới Google Gemini (assistantConsentAt). Hạn mức 30 tin/người/ngày (giờ VN, mọi nhà, ' +
      'tính cả lượt AI lỗi) — vượt thì 429 kèm resetAt. Gemini lỗi / quá 10 giây / trả lời rỗng thì vẫn 201 với tin dự phòng. ' +
      'Hành động trong `assistantMessage.actions` CHỈ LÀ NÚT GỢI Ý: Trợ lý không bao giờ tự tạo nhắc nhở, giao việc hay ghi khoản chi.',
  })
  @ApiBody({ type: SendMessageDto })
  @ApiCreatedResponse({ type: SendMessageResultDto })
  @ApiForbiddenResponse({ description: 'ASSISTANT_CONSENT_REQUIRED (chưa đồng ý dùng Trợ lý) hoặc không phải thành viên nhà này' })
  @ApiTooManyRequestsResponse({ description: 'ASSISTANT_QUOTA_EXCEEDED: đã gửi đủ 30 tin hôm nay; body kèm resetAt (00:00 giờ VN hôm sau)' })
  send(@CurrentMembership() m: HouseMembership, @Body() body: SendMessageDto): Promise<SendMessageResultDto> {
    return this.assistant.send(m, body);
  }
}

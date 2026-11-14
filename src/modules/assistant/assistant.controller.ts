import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
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
@ApiErrors(401, [403, 'The caller is not an active member of this house.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/assistant/messages')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get()
  @ApiOperation({
    summary: 'Read my chat history with the assistant',
    description:
      'Returns only the caller\'s own messages in this house; no endpoint ever returns another member\'s conversation. Without `threadId` the most recent thread is used. ' +
      'A page lists `items` oldest to newest, and `nextCursor` (pagination by creation time and id) is passed back as `cursor` to fetch the next page. ' +
      'There is no endpoint to delete history. Read-only.',
  })
  @ApiOkResponse({ type: AssistantMessagesPageDto, description: 'A page of the caller\'s messages.' })
  @ApiErrors([400, '`threadId`, `cursor` or `limit` is invalid.'])
  list(@CurrentMembership() m: HouseMembership, @Query() query: ListMessagesQuery): Promise<AssistantMessagesPageDto> {
    return this.assistant.list(m, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Send a message to the AI assistant',
    description:
      'Sends a message to the private AI housemate assistant (Gemini) and returns its answer in the same response. The user must first consent to sending chat messages ' +
      'to Google Gemini (`PATCH /users/me/assistant-consent`). Each user may send 30 messages per day across all houses (Vietnam time), counting attempts where the AI failed; ' +
      'beyond that the call fails with 429 and a `resetAt` timestamp (next midnight, Vietnam time). If Gemini fails, takes longer than 10 seconds or answers with nothing, the call ' +
      'still succeeds with 201 and a fallback message. The AI answers in a structured JSON format: a category, the reply text and optionally suggested actions. ' +
      'The actions in `assistantMessage.actions` are only suggested BUTTONS: the assistant never creates reminders, assigns chores or records expenses by itself; ' +
      'only when the user presses a button does the client call the normal API (for example `POST /reminders`).',
  })
  @ApiBody({ type: SendMessageDto })
  @ApiCreatedResponse({ type: SendMessageResultDto, description: 'The stored user message, the assistant\'s answer and the remaining daily quota.' })
  @ApiErrors(
    [400, 'The message is empty, longer than 1000 characters, or `threadId` is invalid.'],
    [403, 'Code `ASSISTANT_CONSENT_REQUIRED` (the user has not consented to Gemini) or the caller is not a member of this house.'],
    [429, 'Code `ASSISTANT_QUOTA_EXCEEDED`: the 30 messages of today are used up; the body includes `resetAt`.'],
  )
  send(@CurrentMembership() m: HouseMembership, @Body() body: SendMessageDto): Promise<SendMessageResultDto> {
    return this.assistant.send(m, body);
  }
}

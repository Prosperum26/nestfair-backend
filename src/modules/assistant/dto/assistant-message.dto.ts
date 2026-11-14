import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssistantCategory, AssistantRole } from '../../../generated/prisma/enums.js';
import type { SafeActionType } from '../assistant-schema.js';

const ACTION_TYPES: SafeActionType[] = ['CREATE_REMINDER', 'CREATE_ADHOC_TASK', 'DRAFT_EXPENSE'];

export class AssistantActionPayloadDto {
  @ApiPropertyOptional({ example: 'Take out the trash', description: 'Suggested title for the reminder, chore or expense.' })
  title?: string;

  @ApiPropertyOptional({ example: '2026-10-25T19:00:00+07:00', description: 'ISO 8601 time with the +07:00 offset; present only for `CREATE_REMINDER`.' })
  remindAt?: string;

  @ApiPropertyOptional({ example: 50_000, description: 'Estimated amount in integer VND; present only for `DRAFT_EXPENSE`.' })
  estimatedAmount?: number;
}

export class AssistantActionDto {
  @ApiProperty({ enum: ACTION_TYPES, enumName: 'AssistantActionType', description: 'What the button would do if pressed: `CREATE_REMINDER`, `CREATE_ADHOC_TASK` or `DRAFT_EXPENSE`. The assistant itself never performs it.' })
  type: SafeActionType;

  @ApiProperty({ example: 'Remind me to take out the trash tonight', description: 'Text on the button.' })
  label: string;

  @ApiProperty({ type: AssistantActionPayloadDto, description: 'Suggested values to prefill the real form or request.' })
  payload: AssistantActionPayloadDto;

  @ApiProperty({ description: 'Meaningful for `CREATE_REMINDER` only: true when a reminder was already created from this button, so the UI disables it (protects against double clicks).' })
  done: boolean;
}

export class AssistantMessageDto {
  @ApiProperty({ format: 'uuid', description: 'Message id.' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Chat thread (session) the message belongs to.' })
  threadId: string;

  @ApiProperty({ enum: AssistantRole, enumName: 'AssistantRole', description: 'Who wrote the message: USER, ASSISTANT or SYSTEM.' })
  role: AssistantRole;

  @ApiProperty({ example: 'The toilet is clogged, what should I do?', description: 'Message text.' })
  content: string;

  @ApiProperty({ enum: AssistantCategory, enumName: 'AssistantCategory', nullable: true, description: 'Topic of an assistant answer: TIP, INCIDENT, EMOTIONAL or REMINDER. null for the user\'s own messages.' })
  category: AssistantCategory | null;

  @ApiProperty({ type: [AssistantActionDto], description: 'Suggested buttons. They are only suggestions: something happens only when the user presses one and the client then calls the normal API. The assistant never writes data itself.' })
  actions: AssistantActionDto[];

  @ApiProperty({ example: '2026-10-25T10:30:00.000Z', description: 'When the message was created (ISO 8601 UTC).' })
  createdAt: string;
}

export class AssistantMessagesPageDto {
  @ApiProperty({ type: [AssistantMessageDto], description: 'Messages of the page, oldest first.' })
  items: AssistantMessageDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Pass it as `cursor` to fetch the next page; null when there is no further page.' })
  nextCursor: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'Thread of the returned messages; null when the caller has no messages yet.' })
  threadId: string | null;
}

export class SendMessageResultDto {
  @ApiProperty({ format: 'uuid', description: 'Thread of the conversation; a new one when the request had no `threadId`.' })
  threadId: string;

  @ApiProperty({ type: AssistantMessageDto, description: 'The message the user just sent, as stored.' })
  userMessage: AssistantMessageDto;

  @ApiProperty({ type: AssistantMessageDto, description: 'The assistant\'s answer, or a fallback message ("the assistant is busy, try again in a few minutes") when the AI failed or took longer than 10 seconds.' })
  assistantMessage: AssistantMessageDto;

  @ApiProperty({ example: 29, description: 'Messages the caller can still send today (quota 30 per user per day, Vietnam time).' })
  remaining: number;
}

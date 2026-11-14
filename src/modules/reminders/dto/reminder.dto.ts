import { ApiProperty } from '@nestjs/swagger';
import { ReminderSource } from '../../../generated/prisma/enums.js';

/** Nhắc nhở cá nhân. `remindAt` / `sentAt` là ISO 8601 (UTC). */
export class ReminderDto {
  @ApiProperty({ format: 'uuid', description: 'Reminder id.' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'House the reminder is attached to (the one given when it was created).' })
  houseId: string;

  @ApiProperty({ example: 'Pay the electricity bill', description: 'Text of the reminder.' })
  title: string;

  @ApiProperty({
    example: '2026-11-01T12:00:00.000Z',
    description: 'When the reminder fires (ISO 8601 UTC).',
  })
  remindAt: string;

  @ApiProperty({
    enum: ReminderSource,
    enumName: 'ReminderSource',
    description: 'Origin: `USER` = created by the user, `ASSISTANT` = created from an assistant suggestion button, `SYSTEM` = created by the system.',
  })
  source: ReminderSource;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'When the notification was delivered (ISO 8601 UTC); null = not sent yet.',
  })
  sentAt: string | null;
}

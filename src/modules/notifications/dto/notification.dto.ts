import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '../../../generated/prisma/enums.js';

/** Một thông báo cá nhân. Thời gian là ISO 8601 (UTC). */
export class NotificationDto {
  @ApiProperty({ format: 'uuid', description: 'Notification id.' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'House the notification belongs to.' })
  houseId: string;

  @ApiProperty({
    enum: NotificationType,
    enumName: 'NotificationType',
    description:
      '`EXPENSE_CREATED` = a new expense includes a share for the caller, `DEBT_PAID` = someone reported a transfer to the caller and waits for confirmation, `REMINDER_DUE` = a personal reminder fired.',
  })
  type: NotificationType;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    example: { expenseId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', title: 'Electricity', payerName: 'Quan', share: 210000 },
    description:
      'Values the client uses to build the sentence. EXPENSE_CREATED: `expenseId`, `title`, `payerName`, `share` (the caller\'s share, integer VND). ' +
      'DEBT_PAID: `settlementId`, `fromName`, `amount` (integer VND). REMINDER_DUE: `reminderId`, `title`.',
  })
  params: Record<string, string | number>;

  @ApiProperty({ type: String, nullable: true, example: null, description: 'When the caller read it (ISO 8601 UTC); null = unread.' })
  readAt: string | null;

  @ApiProperty({ example: '2026-11-11T08:00:00.000Z', description: 'When the notification was created (ISO 8601 UTC).' })
  createdAt: string;
}

export class NotificationListDto {
  @ApiProperty({ type: [NotificationDto], description: 'Newest notifications first.' })
  items: NotificationDto[];

  @ApiProperty({ example: 2, description: 'Number of unread notifications matching the filter, not limited by `limit`.' })
  unreadCount: number;
}

export class MarkAllReadDto {
  @ApiProperty({ example: 2, description: 'How many notifications were switched from unread to read.' })
  updated: number;
}

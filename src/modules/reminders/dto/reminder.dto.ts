import { ApiProperty } from '@nestjs/swagger';
import { ReminderSource } from '../../../generated/prisma/enums.js';

/** Nhắc nhở cá nhân. `remindAt` / `sentAt` là ISO 8601 (UTC). */
export class ReminderDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid', description: 'Nhà mà nhắc gắn với (nhà đang ở khi tạo)' })
  houseId: string;

  @ApiProperty({ example: 'Đóng tiền điện' })
  title: string;

  @ApiProperty({
    example: '2026-11-01T12:00:00.000Z',
    description: 'Thời điểm nhắc (ISO 8601)',
  })
  remindAt: string;

  @ApiProperty({
    enum: ReminderSource,
    enumName: 'ReminderSource',
    description: 'USER = tự tạo, ASSISTANT = từ nút gợi ý của Trợ lý, SYSTEM = hệ thống',
  })
  source: ReminderSource;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Thời điểm đã gửi thông báo; null = chưa gửi',
  })
  sentAt: string | null;
}

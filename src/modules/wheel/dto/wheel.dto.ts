import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDate, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { DueKey } from '../algorithms/due.js';

/** Bỏ ký tự điều khiển, gộp khoảng trắng thừa (tên việc gõ tự do, hiển thị dạng văn bản). */
export const normalizeTitle = (value: unknown): unknown =>
  typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim() : value;

export class SpinWheelDto {
  @ApiProperty({ example: 'Mua nước bình 20L', minLength: 3, maxLength: 60, description: 'Tên việc đột xuất, gõ tự do' })
  @Transform(({ value }: { value: unknown }) => normalizeTitle(value))
  @IsString({ message: 'Tên việc không hợp lệ.' })
  @Length(3, 60, { message: 'Tên việc cần từ 3 đến 60 ký tự.' })
  taskTitle: string;

  @ApiProperty({ type: [String], format: 'uuid', description: 'User.id người tham gia (do người quay chọn, ≥ 2 người)' })
  @IsArray({ message: 'Danh sách người tham gia không hợp lệ.' })
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true, message: 'Người tham gia không hợp lệ.' })
  participantIds: string[];

  @ApiProperty({ example: '2026-10-21T14:00:00.000Z', description: 'Trong [now + 30 phút, now + 48 giờ]' })
  @Type(() => Date)
  @IsDate({ message: 'Hạn chót không hợp lệ.' })
  dueAt: Date;
}

export class VoidSpinDto {
  @ApiProperty({ minLength: 5, maxLength: 200, example: 'Gõ sai tên việc' })
  @Transform(({ value }: { value: unknown }) => normalizeTitle(value))
  @IsString()
  @Length(5, 200, { message: 'Lý do hủy cần từ 5 đến 200 ký tự.' })
  reason: string;
}

export class ListSpinsQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class WheelPersonDto {
  @ApiProperty({ format: 'uuid', description: 'User.id' })
  id: string;

  @ApiProperty({ example: 'Nguyễn Minh Quân' })
  name: string;

  @ApiProperty({ nullable: true, type: String })
  avatarUrl: string | null;
}

export class WheelSpinDto {
  @ApiProperty({ format: 'uuid' })
  spinId: string;

  @ApiProperty()
  taskTitle: string;

  @ApiProperty()
  dueAt: Date;

  @ApiProperty({ enum: ['SPINNING', 'REVEALED', 'VOIDED'] })
  status: 'SPINNING' | 'REVEALED' | 'VOIDED';

  @ApiProperty({ type: WheelPersonDto })
  spunBy: WheelPersonDto;

  @ApiProperty({ type: [WheelPersonDto], description: 'Theo thứ tự hiển thị' })
  participants: WheelPersonDto[];

  @ApiProperty({ description: 'Số người đủ điều kiện nhưng không có trên vòng' })
  excludedCount: number;

  @ApiProperty({ type: [String], description: 'userId của từng lát theo thứ tự trên vòng' })
  slices: string[];

  @ApiProperty({ description: 'Lát kim dừng (đã quyết ở server)' })
  landingIndex: number;

  @ApiProperty({ description: 'Chỉ để vẽ animation, không quyết định người trúng' })
  seed: number;

  @ApiProperty({ description: 'Giờ server bánh xe bắt đầu quay' })
  startAt: Date;

  @ApiProperty({ example: 6000 })
  durationMs: number;

  @ApiProperty()
  revealAt: Date;

  @ApiProperty({ description: 'Giờ server lúc trả lời, để client tính lệch đồng hồ' })
  serverNow: Date;

  @ApiProperty({ type: WheelPersonDto, nullable: true, description: 'null khi đang quay' })
  winner: WheelPersonDto | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'Ca WHEEL, null khi đang quay' })
  assignmentId: string | null;

  @ApiProperty({ description: 'Số ca khác của người trúng trong hôm nay (≥ 2 thì UI cảnh báo nhẹ); 0 khi đang quay' })
  winnerSlotsToday: number;

  @ApiProperty({ nullable: true, type: String })
  voidReason: string | null;
}

export class WheelMemberOptionDto extends WheelPersonDto {
  @ApiProperty({ description: 'Vắng hôm nay: không chọn được' })
  absentToday: boolean;
}

export class DueOptionDto {
  @ApiProperty({ enum: ['IN_2H', 'TONIGHT', 'END_OF_DAY', 'TOMORROW'] })
  key: DueKey;

  @ApiProperty({ example: 'Hết hôm nay 23:59' })
  label: string;

  @ApiProperty()
  dueAt: Date;

  @ApiProperty()
  valid: boolean;

  @ApiProperty({ nullable: true, type: String })
  reason: string | null;
}

export class WheelRemainingDto {
  @ApiProperty({ description: 'Số vòng còn quay được trong giờ này (tối đa 5)' })
  hour: number;

  @ApiProperty({ description: 'Số vòng còn quay được hôm nay (tối đa 10)' })
  day: number;
}

export class WheelOptionsDto {
  @ApiProperty({ type: [WheelMemberOptionDto] })
  members: WheelMemberOptionDto[];

  @ApiProperty({ type: [String], description: 'Chọn sẵn: mọi người đang ở nhà và không vắng hôm nay' })
  defaultParticipantIds: string[];

  @ApiProperty({ type: [DueOptionDto] })
  dueOptions: DueOptionDto[];

  @ApiProperty({ enum: ['IN_2H', 'TONIGHT', 'END_OF_DAY', 'TOMORROW'], nullable: true })
  defaultDueKey: DueKey | null;

  @ApiProperty({ type: WheelRemainingDto })
  remaining: WheelRemainingDto;

  @ApiProperty({ description: 'Cả nhà đang nghỉ hôm nay' })
  houseOnBreak: boolean;

  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'Vòng đang quay (nếu có)' })
  busySpinId: string | null;

  @ApiProperty()
  serverNow: Date;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDate, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { DueKey } from '../algorithms/due.js';

/** Bỏ ký tự điều khiển, gộp khoảng trắng thừa (tên việc gõ tự do, hiển thị dạng văn bản). */
export const normalizeTitle = (value: unknown): unknown =>
  typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim() : value;

export class SpinWheelDto {
  @ApiProperty({ example: 'Buy a 20L water bottle', minLength: 3, maxLength: 60, description: 'Free-text name of the ad-hoc chore (3-60 characters, control characters removed, spaces collapsed).' })
  @Transform(({ value }: { value: unknown }) => normalizeTitle(value))
  @IsString({ message: 'Tên việc không hợp lệ.' })
  @Length(3, 60, { message: 'Tên việc cần từ 3 đến 60 ký tự.' })
  taskTitle: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'User ids of the members on the wheel, chosen by the person who spins (at least 2 eligible, at most 20). Everyone must be an active member of the house and not absent today. The winner is never sent by the client.',
  })
  @IsArray({ message: 'Danh sách người tham gia không hợp lệ.' })
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true, message: 'Người tham gia không hợp lệ.' })
  participantIds: string[];

  @ApiProperty({ example: '2026-10-21T14:00:00.000Z', description: 'Deadline of the chore (ISO 8601): between 30 minutes and 48 hours from now.' })
  @Type(() => Date)
  @IsDate({ message: 'Hạn chót không hợp lệ.' })
  dueAt: Date;
}

export class VoidSpinDto {
  @ApiProperty({ minLength: 5, maxLength: 200, example: 'Mistyped the chore name', description: 'Why the admin cancels the spin (5-200 characters). It is kept on the spin record.' })
  @Transform(({ value }: { value: unknown }) => normalizeTitle(value))
  @IsString()
  @Length(5, 200, { message: 'Lý do hủy cần từ 5 đến 200 ký tự.' })
  reason: string;
}

export class ListSpinsQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20, description: 'Maximum number of spins to return, newest first.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class WheelPersonDto {
  @ApiProperty({ format: 'uuid', description: 'User id.' })
  id: string;

  @ApiProperty({ example: 'Nguyen Minh Quan', description: 'Display name.' })
  name: string;

  @ApiProperty({ nullable: true, type: String, description: 'Avatar image URL, or null.' })
  avatarUrl: string | null;
}

export class WheelSpinDto {
  @ApiProperty({ format: 'uuid', description: 'Spin id.' })
  spinId: string;

  @ApiProperty({ description: 'Name of the ad-hoc chore being assigned.' })
  taskTitle: string;

  @ApiProperty({ description: 'Deadline of the resulting chore (ISO 8601 UTC).' })
  dueAt: Date;

  @ApiProperty({ enum: ['SPINNING', 'REVEALED', 'VOIDED'], description: '`SPINNING` = the animation is running and the winner is hidden in the UI; `REVEALED` = the result is public; `VOIDED` = cancelled by the admin.' })
  status: 'SPINNING' | 'REVEALED' | 'VOIDED';

  @ApiProperty({ type: WheelPersonDto, description: 'The member who pressed the spin button.' })
  spunBy: WheelPersonDto;

  @ApiProperty({ type: [WheelPersonDto], description: 'Members on the wheel, in display order.' })
  participants: WheelPersonDto[];

  @ApiProperty({ description: 'Number of eligible members who were not placed on the wheel.' })
  excludedCount: number;

  @ApiProperty({ type: [String], description: 'User id of each slice, in the order they are drawn on the wheel.' })
  slices: string[];

  @ApiProperty({ description: 'Index of the slice the pointer stops on. The server decided it with a cryptographic random number before the animation starts.' })
  landingIndex: number;

  @ApiProperty({ description: 'Random seed that only shapes the animation (spin curve, extra turns); it does not determine the winner.' })
  seed: number;

  @ApiProperty({ description: 'Server time at which the wheel starts turning (ISO 8601 UTC).' })
  startAt: Date;

  @ApiProperty({ example: 6000, description: 'Length of the animation in milliseconds.' })
  durationMs: number;

  @ApiProperty({ description: 'Server time at which the result becomes public (ISO 8601 UTC).' })
  revealAt: Date;

  @ApiProperty({ description: 'Server time when this response was produced; clients use it to correct clock skew.' })
  serverNow: Date;

  @ApiProperty({ type: WheelPersonDto, nullable: true, description: 'The winner; null while the wheel is still spinning.' })
  winner: WheelPersonDto | null;

  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'Id of the chore assignment created for the winner; null while spinning.' })
  assignmentId: string | null;

  @ApiProperty({ description: 'How many other chores the winner already has today (2 or more makes the UI show a gentle warning); 0 while spinning.' })
  winnerSlotsToday: number;

  @ApiProperty({ nullable: true, type: String, description: 'Reason given by the admin when the spin was voided; otherwise null.' })
  voidReason: string | null;
}

export class WheelMemberOptionDto extends WheelPersonDto {
  @ApiProperty({ description: 'true when the member is absent today and therefore cannot be chosen.' })
  absentToday: boolean;
}

export class DueOptionDto {
  @ApiProperty({ enum: ['IN_2H', 'TONIGHT', 'END_OF_DAY', 'TOMORROW'], description: 'Preset deadline: in 2 hours, today 21:00, today 23:59 or tomorrow 21:00 (Vietnam time).' })
  key: DueKey;

  @ApiProperty({ example: 'Until end of today 23:59', description: 'Localized (Vietnamese) label for the UI.' })
  label: string;

  @ApiProperty({ description: 'The deadline this preset stands for (ISO 8601 UTC).' })
  dueAt: Date;

  @ApiProperty({ description: 'false when the preset falls outside the allowed window of 30 minutes to 48 hours from now.' })
  valid: boolean;

  @ApiProperty({ nullable: true, type: String, description: 'Localized (Vietnamese) reason why the preset is invalid, or null.' })
  reason: string | null;
}

export class WheelRemainingDto {
  @ApiProperty({ description: 'Spins the house can still make in the current hour (limit 5).' })
  hour: number;

  @ApiProperty({ description: 'Spins the house can still make today (limit 10).' })
  day: number;
}

export class WheelOptionsDto {
  @ApiProperty({ type: [WheelMemberOptionDto], description: 'Active members with an `absentToday` flag.' })
  members: WheelMemberOptionDto[];

  @ApiProperty({ type: [String], description: 'User ids preselected in the UI: every active member who is not absent today.' })
  defaultParticipantIds: string[];

  @ApiProperty({ type: [DueOptionDto], description: 'Preset deadlines to choose from.' })
  dueOptions: DueOptionDto[];

  @ApiProperty({ enum: ['IN_2H', 'TONIGHT', 'END_OF_DAY', 'TOMORROW'], nullable: true, description: 'Preset to preselect: end of today if valid, otherwise the nearest valid one; null when none is valid.' })
  defaultDueKey: DueKey | null;

  @ApiProperty({ type: WheelRemainingDto, description: 'Remaining spin quota of the house.' })
  remaining: WheelRemainingDto;

  @ApiProperty({ description: 'true when the whole house is on break today, so the wheel cannot be spun.' })
  houseOnBreak: boolean;

  @ApiProperty({ format: 'uuid', nullable: true, type: String, description: 'Id of the spin currently running in the house, if any; only one spin can run at a time.' })
  busySpinId: string | null;

  @ApiProperty({ description: 'Server time of this response (ISO 8601 UTC).' })
  serverNow: Date;
}

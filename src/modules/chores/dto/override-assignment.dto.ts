import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export const OVERRIDE_ACTIONS = ['FORCE_DONE', 'FORCE_REJECT', 'REASSIGN', 'CANCEL'] as const;
export type OverrideAction = (typeof OVERRIDE_ACTIONS)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class OverrideAssignmentDto {
  @ApiProperty({ enum: OVERRIDE_ACTIONS, description: '`FORCE_DONE` marks the assignment done, `FORCE_REJECT` rejects its proof, `REASSIGN` gives it to `userId`, `CANCEL` cancels it.' })
  @IsIn(OVERRIDE_ACTIONS, { message: 'Hành động không hợp lệ.' })
  action: OverrideAction;

  @ApiProperty({ minLength: 5, maxLength: 200, description: 'Required explanation (5-200 characters), written to the chore audit log.' })
  @Transform(trim)
  @IsString({ message: 'Hãy nhập lý do.' })
  @Length(5, 200, { message: 'Lý do cần từ 5 đến 200 ký tự.' })
  reason: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'User id of the new assignee. Required when `action` is REASSIGN, ignored otherwise.' })
  @ValidateIf((o: OverrideAssignmentDto) => o.action === 'REASSIGN')
  @IsUUID(undefined, { message: 'Hãy chọn người nhận ca.' })
  userId?: string;
}

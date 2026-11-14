import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { normalizeInviteCode } from '../invite-code.js';

export class JoinHouseDto {
  @ApiProperty({
    example: 'K7M2QZ',
    description:
      'The 6-character invite code. Case-insensitive; spaces and dashes are ignored.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeInviteCode(value) : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9]{6}$/, { message: 'Mã mời gồm 6 ký tự chữ và số.' })
  inviteCode: string;
}

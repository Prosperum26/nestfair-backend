import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ListingStatus } from '../../../generated/prisma/enums.js';

export class ListingStatusDto {
  @ApiProperty({
    enum: ListingStatus,
    enumName: 'ListingStatus',
    description: 'Target status. `OPEN` publishes (or reopens) the listing; `DRAFT` hides an open listing again; `CLOSED` closes it. A closed listing cannot return to DRAFT.',
  })
  @IsEnum(ListingStatus, { message: 'Trạng thái tin không hợp lệ.' })
  status: ListingStatus;
}

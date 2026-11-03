import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ListingStatus } from '../../../generated/prisma/enums.js';

export class ListingStatusDto {
  @ApiProperty({
    enum: ListingStatus,
    enumName: 'ListingStatus',
    description: 'OPEN = đăng / mở lại, DRAFT = tạm ẩn, CLOSED = đóng tin',
  })
  @IsEnum(ListingStatus, { message: 'Trạng thái tin không hợp lệ.' })
  status: ListingStatus;
}

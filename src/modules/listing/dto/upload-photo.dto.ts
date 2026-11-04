import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ListingPhotoCategory } from '../../../generated/prisma/enums.js';

/** Trường văn bản đi kèm file `photo` trong form multipart. */
export class UploadPhotoDto {
  @ApiProperty({ enum: ListingPhotoCategory, enumName: 'ListingPhotoCategory' })
  @IsEnum(ListingPhotoCategory, { message: 'Nhóm ảnh không hợp lệ.' })
  category: ListingPhotoCategory;
}

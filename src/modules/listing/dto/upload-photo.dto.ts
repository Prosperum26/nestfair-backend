import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { ListingPhotoCategory } from '../../../generated/prisma/enums.js';

/** Trường văn bản đi kèm file `photo` trong form multipart. */
export class UploadPhotoDto {
  @ApiProperty({ enum: ListingPhotoCategory, enumName: 'ListingPhotoCategory', description: 'Photo group the image belongs to: BEDROOM, BATHROOM or LIVING (sent as a text field next to the `photo` file).' })
  @IsEnum(ListingPhotoCategory, { message: 'Nhóm ảnh không hợp lệ.' })
  category: ListingPhotoCategory;
}

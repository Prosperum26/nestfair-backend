import { Controller, Get, Header, Param, UseGuards } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PublicListingClosedDto, type PublicListingDto, PublicListingOpenDto } from './dto/public-listing.dto.js';
import { PublicListingService } from './public-listing.service.js';

/** Công khai, không JWT. Giới hạn 60 lần/phút/IP; mỗi lần đọc xong là hết, không ghi gì. */
@ApiTags('public')
@ApiExtraModels(PublicListingOpenDto, PublicListingClosedDto)
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('public/listings')
export class PublicListingController {
  constructor(private readonly publicListing: PublicListingService) {}

  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'slug', example: 'x7Kp2QmA', description: '8 ký tự 0-9A-Za-z' })
  @ApiOperation({
    summary: 'Trang công khai của tin tìm người ở ghép. Không trả email, STK, họ tên hay tên nhà.',
    description:
      'Tin đang mở: đầy đủ nội dung và liên hệ. Tin đã đóng hoặc nhà đã đủ người: bản rút gọn (không có liên hệ, lịch trực, ảnh).',
  })
  @ApiOkResponse({
    schema: { oneOf: [{ $ref: getSchemaPath(PublicListingOpenDto) }, { $ref: getSchemaPath(PublicListingClosedDto) }] },
  })
  @ApiNotFoundResponse({ description: 'LISTING_NOT_FOUND: slug sai hoặc tin đang tạm ẩn' })
  @ApiTooManyRequestsResponse({ description: 'Quá 60 lần/phút' })
  get(@Param('slug') slug: string): Promise<PublicListingDto> {
    return this.publicListing.get(slug);
  }
}

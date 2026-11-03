import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { HouseRoles, HouseRolesGuard } from '../houses/guards/house-roles.guard.js';
import type { UploadedImage } from '../uploads/image-validation.js';
import { ListingPayloadDto, ListingPhotoDto } from './dto/listing-response.dto.js';
import { UploadPhotoDto } from './dto/upload-photo.dto.js';
import { UpsertListingDto } from './dto/upsert-listing.dto.js';
import { ListingPhotosService } from './listing-photos.service.js';
import { ListingService } from './listing.service.js';

/** Multer chặn cứng ở 10MB; validateImageFile trả lỗi 413 thân thiện ở mốc 5MB. */
const HARD_LIMIT_BYTES = 10 * 1024 * 1024;

@ApiTags('listing')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này (hoặc không phải trưởng phòng khi ghi)' })
@ApiNotFoundResponse({ description: 'houseId không hợp lệ' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/listing')
export class ListingController {
  constructor(
    private readonly listing: ListingService,
    private readonly photos: ListingPhotosService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Tin tìm người ở ghép của nhà (hoặc null) kèm số chỗ, điện nước ước tính và gợi ý điền sẵn' })
  @ApiOkResponse({ type: ListingPayloadDto })
  get(@CurrentMembership() m: HouseMembership, @CurrentUser() user: AuthUser): Promise<ListingPayloadDto> {
    return this.listing.getForHouse(m.houseId, user.id);
  }

  @Put()
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiOperation({
    summary: 'Trưởng phòng tạo (DRAFT) hoặc cập nhật nội dung tin. Không đổi trạng thái hay slug.',
  })
  @ApiOkResponse({ type: ListingPayloadDto })
  @ApiBadRequestResponse({ description: 'Dữ liệu không hợp lệ (kể cả field lạ như status, slug)' })
  upsert(
    @CurrentMembership() m: HouseMembership,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertListingDto,
  ): Promise<ListingPayloadDto> {
    return this.listing.upsert(m.houseId, user.id, dto);
  }

  @Post('photos')
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard, ThrottlerGuard)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: HARD_LIMIT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo', 'category'],
      properties: {
        photo: { type: 'string', format: 'binary', description: 'JPG/PNG/WEBP, tối đa 5MB' },
        category: { type: 'string', enum: ['BEDROOM', 'BATHROOM', 'LIVING'] },
      },
    },
  })
  @ApiOperation({ summary: 'Trưởng phòng tải ảnh lên một nhóm (tối đa 6 ảnh mỗi nhóm)' })
  @ApiCreatedResponse({ type: ListingPhotoDto })
  @ApiBadRequestResponse({ description: 'Thiếu file hoặc nhóm ảnh không hợp lệ' })
  @ApiNotFoundResponse({ description: 'LISTING_NOT_FOUND: nhà chưa có tin' })
  @ApiUnprocessableEntityResponse({ description: 'PHOTO_LIMIT: nhóm đã đủ 6 ảnh' })
  @ApiServiceUnavailableResponse({ description: 'UPLOAD_UNAVAILABLE: chưa cấu hình / lỗi Cloudinary' })
  addPhoto(
    @CurrentMembership() m: HouseMembership,
    @Body() dto: UploadPhotoDto,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<ListingPhotoDto> {
    return this.photos.add(m.houseId, dto.category, file);
  }

  @Delete('photos/:photoId')
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiParam({ name: 'photoId', format: 'uuid' })
  @ApiOperation({ summary: 'Trưởng phòng xóa ảnh (tin đang đăng không được mất ảnh cuối của nhóm)' })
  @ApiOkResponse({ schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } })
  @ApiNotFoundResponse({ description: 'Không có ảnh này trong tin của nhà' })
  @ApiUnprocessableEntityResponse({ description: 'PHOTO_REQUIRED: xóa ảnh cuối của nhóm khi tin đang OPEN' })
  removePhoto(
    @CurrentMembership() m: HouseMembership,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<{ ok: true }> {
    return this.photos.remove(m.houseId, photoId);
  }
}

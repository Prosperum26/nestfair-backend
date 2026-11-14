import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_STRICT } from '../../common/throttle/throttle.config.js';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
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
import { ListingStatusDto } from './dto/listing-status.dto.js';
import { ListingPhotosService } from './listing-photos.service.js';
import { ListingStatusService } from './listing-status.service.js';
import { ListingService } from './listing.service.js';

/** Multer chặn cứng ở 10MB; validateImageFile trả lỗi 413 thân thiện ở mốc 5MB. */
const HARD_LIMIT_BYTES = 10 * 1024 * 1024;

@ApiTags('listings')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house, or (for write operations) not the admin.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/listing')
export class ListingController {
  constructor(
    private readonly listing: ListingService,
    private readonly photos: ListingPhotosService,
    private readonly status: ListingStatusService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get the house\'s roommate listing',
    description:
      'Returns the house\'s single roommate-finding listing (or `listing: null` when none exists yet) together with everything the editing screen needs: ' +
      'the public URL, the number of free places, an electricity-and-water estimate averaged over the last 3 closed months, the estimated monthly cost per person, ' +
      'the photo groups still missing, and values to prefill the form (house address, the caller\'s phone). Any active member can read it. Read-only.',
  })
  @ApiOkResponse({ type: ListingPayloadDto, description: 'The listing payload.' })
  get(@CurrentMembership() m: HouseMembership, @CurrentUser() user: AuthUser): Promise<ListingPayloadDto> {
    return this.listing.getForHouse(m.houseId, user.id);
  }

  @Put()
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiOperation({
    summary: 'Create or update the listing content (admin)',
    description:
      'Saves the text content of the listing: location, gender wanted, rent, other fees, description, expectations, contact phone and whether the roster is shown. ' +
      'The first call creates the listing as a `DRAFT` and generates its permanent 8-character slug; later calls edit it in place. ' +
      'It never changes the status or the slug: sending `status` or `slug` is rejected with 400, and publishing goes through the status endpoint. Admin only.',
  })
  @ApiOkResponse({ type: ListingPayloadDto, description: 'The saved listing payload.' })
  @ApiErrors([400, 'Invalid body, including unknown fields such as `status` or `slug`.'])
  upsert(
    @CurrentMembership() m: HouseMembership,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertListingDto,
  ): Promise<ListingPayloadDto> {
    return this.listing.upsert(m.houseId, user.id, dto);
  }

  @Patch('status')
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiOperation({
    summary: 'Publish, hide, close or reopen the listing (admin)',
    description:
      'Moves the listing between `DRAFT` (hidden), `OPEN` (public) and `CLOSED`. Publishing or reopening (`OPEN`) needs at least one free place in the house ' +
      '(else 409 `HOUSE_FULL`) and at least one photo in each of the three groups (else 422 `LISTING_INCOMPLETE` with the list of missing groups). ' +
      'A closed listing cannot go back to `DRAFT`. Closing by hand records the reason `MANUAL` and broadcasts `listing:closed`. ' +
      'Independently of this endpoint the server closes an open listing automatically with reason `FULL` when the house fills up, and reopens it with `listing:reopened` ' +
      'when a place frees up again (only for listings closed as `FULL`, never for those the admin closed by hand). Setting the current status again changes nothing. Admin only.',
  })
  @ApiOkResponse({ type: ListingPayloadDto, description: 'The listing payload after the change.' })
  @ApiErrors(
    [400, '`status` is not DRAFT, OPEN or CLOSED.'],
    [404, 'Code `LISTING_NOT_FOUND`: the house has no listing yet; save the content first.'],
    [409, 'Code `HOUSE_FULL`: there is no free place, so the listing cannot be opened.'],
    [422, 'Codes `LISTING_INCOMPLETE` (response includes `missing`, the photo groups that have none) or `LISTING_STATUS_INVALID` (a closed listing cannot become a draft).'],
  )
  setStatus(
    @CurrentMembership() m: HouseMembership,
    @Body() dto: ListingStatusDto,
  ): Promise<ListingPayloadDto> {
    return this.status.setStatus(m.houseId, m, dto.status);
  }

  @Post('photos')
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @Throttle(THROTTLE_STRICT)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: HARD_LIMIT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo', 'category'],
      properties: {
        photo: { type: 'string', format: 'binary', description: 'Photo: JPEG, PNG or WebP, up to 5 MB.' },
        category: { type: 'string', enum: ['BEDROOM', 'BATHROOM', 'LIVING'], description: 'Photo group the image belongs to.' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a listing photo (admin)',
    description:
      'Adds one photo (multipart fields `photo` and `category`) to a group of the listing. Each group (BEDROOM, BATHROOM, LIVING) holds at most 6 photos, and the listing ' +
      'must already exist. The image is validated (JPEG, PNG or WebP, up to 5 MB) and stored; the new photo goes to the end of its group. Admin only.',
  })
  @ApiCreatedResponse({ type: ListingPhotoDto, description: 'The stored photo.' })
  @ApiErrors(
    [400, 'Codes `PHOTO_FILE_REQUIRED` (no file) or an invalid `category`.'],
    [404, 'Code `LISTING_NOT_FOUND`: the house has no listing yet.'],
    [413, 'Code `IMAGE_TOO_LARGE`: the image is larger than 5 MB.'],
    [415, 'Code `UNSUPPORTED_IMAGE`: the file is not a JPEG, PNG or WebP image.'],
    [422, 'Code `PHOTO_LIMIT`: the group already has 6 photos.'],
    [503, 'Code `UPLOAD_UNAVAILABLE`: image storage is not configured or failed.'],
  )
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
  @ApiParam({ name: 'photoId', format: 'uuid', description: 'Id of the photo to delete.' })
  @ApiOperation({
    summary: 'Delete a listing photo (admin)',
    description: 'Removes a photo from the listing. While the listing is `OPEN` the last photo of a group cannot be removed, because a published listing needs at least one photo in each group; hide the listing first. Admin only.',
  })
  @ApiOkResponse({ description: 'The photo was deleted.', schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } })
  @ApiErrors(
    [404, 'The photo does not exist in this house\'s listing.'],
    [422, 'Code `PHOTO_REQUIRED`: it is the last photo of its group and the listing is open.'],
  )
  removePhoto(
    @CurrentMembership() m: HouseMembership,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<{ ok: true }> {
    return this.photos.remove(m.houseId, photoId);
  }

  @Patch('photos/:photoId/cover')
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiParam({ name: 'photoId', format: 'uuid', description: 'Id of the bedroom photo to use as the cover.' })
  @ApiOperation({
    summary: 'Choose the cover photo (admin)',
    description: 'Moves a bedroom photo to the front of the BEDROOM group, making it the cover shown on the listing card and the poster. Only bedroom photos can be the cover. Admin only.',
  })
  @ApiOkResponse({ type: ListingPhotoDto, description: 'The photo, now first in its group.' })
  @ApiErrors(
    [404, 'The photo does not exist in this house\'s listing.'],
    [422, 'Code `COVER_CATEGORY_INVALID`: only a bedroom photo can be the cover.'],
  )
  setCover(
    @CurrentMembership() m: HouseMembership,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<ListingPhotoDto> {
    return this.photos.setCover(m.houseId, photoId);
  }
}

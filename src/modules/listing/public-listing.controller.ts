import { Controller, Get, Header, Param } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { PublicListingClosedDto, type PublicListingDto, PublicListingOpenDto } from './dto/public-listing.dto.js';
import { PublicListingService } from './public-listing.service.js';

/** Công khai, không JWT. Giới hạn 60 lần/phút/IP; mỗi lần đọc xong là hết, không ghi gì. */
@ApiTags('public-listings')
@ApiExtraModels(PublicListingOpenDto, PublicListingClosedDto)
@Throttle({ default: { limit: 60, ttl: 60_000 } })
@Controller('public/listings')
export class PublicListingController {
  constructor(private readonly publicListing: PublicListingService) {}

  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'slug', example: 'x7Kp2QmA', description: 'Public identifier of the listing: exactly 8 characters from 0-9, A-Z, a-z.' })
  @ApiOperation({
    summary: 'View a public roommate listing',
    description:
      'No authentication. Returns the public page data of a listing by its slug, for the shareable link `/r/{slug}` and for the poster QR code. ' +
      'An open listing returns the full content: location, rent, fees, utilities estimate, free places, photos, the contact phone and, if the admin allows it, this week\'s ' +
      'chore roster with anonymous labels ("TV1", "TV2"). A closed listing (the house is full, or the admin closed it) returns a short variant with only the slug, ' +
      'the close reason, the location and a cover photo, so visitors see a friendly "no longer available" page. ' +
      'The response never contains email addresses, bank accounts, member names, user or house ids or the invite code. The call only reads data and is not cached. ' +
      'An unknown or malformed slug and a hidden (draft) listing all return the same 404, so existence cannot be probed. Limited to 60 requests per minute per client.',
  })
  @ApiOkResponse({
    description: 'An open listing (`status` OPEN) or the short closed variant (`status` CLOSED).',
    schema: { oneOf: [{ $ref: getSchemaPath(PublicListingOpenDto) }, { $ref: getSchemaPath(PublicListingClosedDto) }] },
  })
  @ApiErrors([404, 'Code `LISTING_NOT_FOUND`: the slug is wrong or malformed, or the listing is a hidden draft.'], [429, 'More than 60 requests per minute.'])
  get(@Param('slug') slug: string): Promise<PublicListingDto> {
    return this.publicListing.get(slug);
  }
}

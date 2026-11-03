import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { HouseRoles, HouseRolesGuard } from '../houses/guards/house-roles.guard.js';
import { ListingPayloadDto } from './dto/listing-response.dto.js';
import { UpsertListingDto } from './dto/upsert-listing.dto.js';
import { ListingService } from './listing.service.js';

@ApiTags('listing')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này (hoặc không phải trưởng phòng khi ghi)' })
@ApiNotFoundResponse({ description: 'houseId không hợp lệ' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/listing')
export class ListingController {
  constructor(private readonly listing: ListingService) {}

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
}

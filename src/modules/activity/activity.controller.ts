import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { ActivityService } from './activity.service.js';
import { ActivityDto, ListActivityQuery } from './dto/activity.dto.js';

@ApiTags('activity')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @ApiOperation({
    summary: 'Bảng tin hoạt động (Live Ticker), mới nhất trước. `before` để cuộn thêm, `since` để bù sau khi nối lại.',
  })
  @ApiOkResponse({ type: [ActivityDto] })
  @ApiBadRequestResponse({ description: 'limit / before / since không hợp lệ' })
  list(@CurrentMembership() m: HouseMembership, @Query() query: ListActivityQuery): Promise<ActivityDto[]> {
    return this.activity.list(m.houseId, m.role === 'ADMIN', query);
  }
}

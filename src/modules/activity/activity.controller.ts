import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { ActivityService } from './activity.service.js';
import { ActivityDto, ListActivityQuery } from './dto/activity.dto.js';

@ApiTags('activity')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @ApiOperation({
    summary: 'List recent house activity',
    description:
      'The live ticker of the house: who did what, newest first. Each entry has a machine-readable `type` and non-sensitive `params`; the client composes the sentence. ' +
      'Page backwards with `before` and `limit` (up to 50). After a socket reconnect pass `since` to receive everything newer than the last entry the client has (up to 100). ' +
      'Entries are kept for 30 days. Regular members do not see entries reserved for the admin. New entries are also pushed live as the socket event `activity:new`. Read-only.',
  })
  @ApiOkResponse({ type: [ActivityDto], description: 'Activity entries, newest first.' })
  @ApiErrors([400, '`limit`, `before` or `since` is invalid.'])
  list(@CurrentMembership() m: HouseMembership, @Query() query: ListActivityQuery): Promise<ActivityDto[]> {
    return this.activity.list(m.houseId, m.role === 'ADMIN', query);
  }
}

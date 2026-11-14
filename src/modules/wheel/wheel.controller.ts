import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import { ListSpinsQuery, SpinWheelDto, VoidSpinDto, WheelOptionsDto, WheelSpinDto } from './dto/wheel.dto.js';
import { WheelService } from './wheel.service.js';

@ApiTags('wheel')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/wheel')
export class HouseWheelController {
  constructor(private readonly wheel: WheelService) {}

  @Get('options')
  @ApiOperation({
    summary: 'Get the data for the wheel dialog',
    description:
      'Everything the client needs to open the spin dialog: the active members with an "absent today" flag, the preselected participants (everyone present), ' +
      'the preset deadlines with their validity, how many spins the house has left this hour and today, whether the whole house is on break, and the id of a spin that is ' +
      'currently running (only one spin can run at a time). Read-only.',
  })
  @ApiOkResponse({ type: WheelOptionsDto, description: 'Dialog data.' })
  options(@CurrentMembership() m: HouseMembership): Promise<WheelOptionsDto> {
    return this.wheel.options(m.houseId);
  }

  @Post('spin')
  @ApiOperation({
    summary: 'Spin the Lucky Wheel',
    description:
      'Assigns an ad-hoc chore to a random member. The caller names the chore, the participants (at least 2 eligible, none absent today) and a deadline between 30 minutes ' +
      'and 48 hours from now. The SERVER picks the winner with a cryptographic random number; the client can neither choose nor suggest it (sending `winnerId` is rejected with 400) ' +
      'and only animates the wheel from the returned `landingIndex` and `seed`. In one transaction the server writes the spin log and a chore assignment for the winner, ' +
      'then broadcasts `wheel:spinning` and, when the animation ends (about 6 seconds), `wheel:result`. Only one spin can run per house, and a house may spin 5 times per hour ' +
      'and 10 times per day. The first call returns 201; repeating it with the same Idempotency-Key returns the original spin with 200.',
  })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Client-generated unique key (for example a UUID) that makes the call safe to retry: repeating it returns the original result instead of acting twice. Required; omitting it returns 400 `IDEMPOTENCY_KEY_REQUIRED`.' })
  @ApiCreatedResponse({ type: WheelSpinDto, description: 'The new spin (status SPINNING; `winner` is still null in the UI until the reveal).' })
  @ApiOkResponse({ type: WheelSpinDto, description: 'The same Idempotency-Key was used before; the original spin is returned.' })
  @ApiErrors(
    [400, 'Invalid body, an unknown field such as `winnerId`, or code `IDEMPOTENCY_KEY_REQUIRED`.'],
    [409, 'Code `WHEEL_BUSY`: another spin is running (the body includes `retryAfterMs` and `spinId`).'],
    [422, 'Codes `WHEEL_NEEDS_2_ELIGIBLE`, `PARTICIPANT_NOT_MEMBER`, `PARTICIPANT_ABSENT`, `PARTICIPANT_DUPLICATE`, `WHEEL_HOUSE_BREAK` or `WHEEL_DUE_INVALID`.'],
    [429, 'Code `WHEEL_RATE_LIMIT`: more than 5 spins in an hour or 10 in a day for this house.'],
  )
  async spin(
    @CurrentMembership() m: HouseMembership,
    @Body() dto: SpinWheelDto,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WheelSpinDto> {
    const { created, spin } = await this.wheel.spin(m, dto, key);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return spin;
  }

  @Get('current')
  @ApiOperation({
    summary: 'Get the current spin',
    description: 'Returns the spin that is running or that finished within the last 60 seconds, so a client that joins late or reconnects can show the animation or the result. Responds 204 when there is none. Read-only.',
  })
  @ApiOkResponse({ type: WheelSpinDto, description: 'The running or just-finished spin.' })
  @ApiNoContentResponse({ description: 'No spin is running and none finished in the last 60 seconds.' })
  async current(@CurrentMembership() m: HouseMembership, @Res({ passthrough: true }) res: Response): Promise<WheelSpinDto | undefined> {
    const spin = await this.wheel.current(m.houseId);
    if (!spin) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return spin;
  }

  @Get('spins')
  @ApiOperation({
    summary: 'List past spins',
    description: 'Spin history of the house, newest first, with participants and winners so everyone can verify the draw. Read-only.',
  })
  @ApiOkResponse({ type: [WheelSpinDto], description: 'Recent spins.' })
  @ApiErrors([400, '`limit` is not an integer between 1 and 50.'])
  history(@CurrentMembership() m: HouseMembership, @Query() q: ListSpinsQuery): Promise<WheelSpinDto[]> {
    return this.wheel.history(m.houseId, q.limit);
  }
}

@ApiTags('wheel')
@ApiBearerAuth()
@ApiErrors(401)
@UseGuards(JwtAuthGuard)
@Controller('wheel/spins')
export class WheelSpinsController {
  constructor(private readonly wheel: WheelService) {}

  @Post(':spinId/void')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'spinId', format: 'uuid', description: 'Id of the spin to cancel. The house is derived from it.' })
  @ApiOperation({
    summary: 'Void a spin (admin)',
    description:
      'The house admin cancels a spin, for example because the chore name was mistyped. The chore assignment created for the winner must still be TODO and not checked in; ' +
      'it becomes CANCELLED and the spin becomes VOIDED with the given reason. A voided spin still counts toward the hourly and daily spin limits. Broadcasts `wheel:voided`. Admin only.',
  })
  @ApiOkResponse({ type: WheelSpinDto, description: 'The voided spin.' })
  @ApiErrors(
    [400, 'The reason is missing or not 5-200 characters long.'],
    [403, 'Code `ADMIN_ONLY`: only the house admin may void a spin.'],
    [404, 'The spin does not exist or belongs to a house the caller is not in.'],
    [409, 'Code `ASSIGNMENT_STATE_CHANGED`: the winner already submitted the chore, or it was cancelled or changed.'],
  )
  void(@CurrentUser() user: AuthUser, @Param('spinId', ParseUUIDPipe) spinId: string, @Body() dto: VoidSpinDto): Promise<WheelSpinDto> {
    return this.wheel.void(user.id, spinId, dto.reason);
  }
}

import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { PublicUserDto } from '../auth/dto/auth-response.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Hồ sơ của tôi' })
  @ApiOkResponse({ type: PublicUserDto })
  getMe(@CurrentUser() user: AuthUser): Promise<PublicUserDto> {
    return this.users.getMe(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Cập nhật họ tên, SĐT, tài khoản nhận tiền (ngân hàng + STK)',
  })
  @ApiOkResponse({ type: PublicUserDto })
  @ApiBadRequestResponse({ description: 'Sai định dạng hoặc thiếu cặp ngân hàng / STK' })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<PublicUserDto> {
    return this.users.updateMe(user.id, dto);
  }
}

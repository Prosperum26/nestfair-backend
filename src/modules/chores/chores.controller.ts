import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import {
  type HouseMembership,
  HouseMemberGuard,
} from '../houses/guards/house-member.guard.js';
import {
  HouseRoles,
  HouseRolesGuard,
} from '../houses/guards/house-roles.guard.js';
import { ChoresService } from './chores.service.js';
import { ChoreDto } from './dto/chore-response.dto.js';
import { CreateChoreDto } from './dto/create-chore.dto.js';
import { ListChoresQuery } from './dto/list-chores.query.js';
import { UpdateChoreDto } from './dto/update-chore.dto.js';

@ApiTags('chores')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({
  description: 'Không phải thành viên nhà này (hoặc không đủ quyền)',
})
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard, HouseRolesGuard)
@Controller('houses/:houseId/chores')
export class ChoresController {
  constructor(private readonly chores: ChoresService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách việc nhà (mặc định chỉ việc đang bật)' })
  @ApiOkResponse({ type: [ChoreDto] })
  list(
    @CurrentMembership() m: HouseMembership,
    @Query() query: ListChoresQuery,
  ): Promise<ChoreDto[]> {
    return this.chores.list(m.houseId, query.includeInactive);
  }

  @Post()
  @HouseRoles('ADMIN')
  @ApiOperation({ summary: 'Trưởng phòng thêm việc mới' })
  @ApiCreatedResponse({ type: ChoreDto })
  @ApiBadRequestResponse({ description: 'Dữ liệu không hợp lệ' })
  create(
    @CurrentMembership() m: HouseMembership,
    @Body() dto: CreateChoreDto,
  ): Promise<ChoreDto> {
    return this.chores.create(m.houseId, m.id, dto);
  }

  @Patch(':choreId')
  @HouseRoles('ADMIN')
  @ApiParam({ name: 'choreId', format: 'uuid' })
  @ApiOperation({ summary: 'Trưởng phòng sửa tên, độ nặng hoặc tạm ngưng việc' })
  @ApiOkResponse({ type: ChoreDto })
  @ApiNotFoundResponse({ description: 'Việc không thuộc nhà này' })
  @ApiForbiddenResponse({ description: 'SYSTEM_CHORE: "Việc đột xuất" của vòng quay là việc hệ thống, không sửa được' })
  update(
    @CurrentMembership() m: HouseMembership,
    @Param('choreId', ParseUUIDPipe) choreId: string,
    @Body() dto: UpdateChoreDto,
  ): Promise<ChoreDto> {
    return this.chores.update(m.houseId, m.id, choreId, dto);
  }
}

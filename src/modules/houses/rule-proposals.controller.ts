import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { CurrentMembership } from './decorators/current-membership.decorator.js';
import { CreateRuleProposalDto, RejectRuleProposalDto, RuleProposalDto } from './dto/rule-proposal.dto.js';
import { type HouseMembership, HouseMemberGuard } from './guards/house-member.guard.js';
import { HouseRoles, HouseRolesGuard } from './guards/house-roles.guard.js';
import { RuleProposalsService } from './rule-proposals.service.js';

@ApiTags('rule-proposals')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiParam({ name: 'houseId', format: 'uuid' })
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này, hoặc không đủ quyền' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/rule-proposals')
export class RuleProposalsController {
  constructor(private readonly proposals: RuleProposalsService) {}

  @Get()
  @ApiOperation({ summary: 'Các đề xuất nội quy của nhà (cả nhà xem được), mới nhất trước' })
  @ApiOkResponse({ type: [RuleProposalDto] })
  list(@CurrentMembership() membership: HouseMembership): Promise<RuleProposalDto[]> {
    return this.proposals.list(membership.houseId);
  }

  @Post()
  @ApiOperation({ summary: 'Thành viên đề xuất thêm / sửa / bỏ một điều nội quy (tối đa 3 đề xuất đang chờ)' })
  @ApiCreatedResponse({ type: RuleProposalDto })
  @ApiBadRequestResponse({ description: 'Thiếu nội dung, hoặc điều cần sửa không còn trong nội quy' })
  @ApiConflictResponse({ description: 'TOO_MANY_PENDING: đã có 3 đề xuất đang chờ' })
  create(
    @CurrentMembership() membership: HouseMembership,
    @Body() dto: CreateRuleProposalDto,
  ): Promise<RuleProposalDto> {
    return this.proposals.create(membership, dto);
  }

  @Post(':proposalId/approve')
  @HttpCode(HttpStatus.OK)
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiParam({ name: 'proposalId', format: 'uuid' })
  @ApiOperation({ summary: 'Trưởng phòng duyệt: áp ngay vào nội quy' })
  @ApiOkResponse({ type: RuleProposalDto })
  @ApiNotFoundResponse({ description: 'Không có đề xuất này trong nhà' })
  @ApiConflictResponse({ description: 'ALREADY_DECIDED, RULE_CHANGED hoặc RULES_TOO_LONG' })
  approve(
    @CurrentMembership() membership: HouseMembership,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ): Promise<RuleProposalDto> {
    return this.proposals.approve(membership, proposalId);
  }

  @Post(':proposalId/reject')
  @HttpCode(HttpStatus.OK)
  @HouseRoles('ADMIN')
  @UseGuards(HouseRolesGuard)
  @ApiParam({ name: 'proposalId', format: 'uuid' })
  @ApiOperation({ summary: 'Trưởng phòng từ chối, kèm lý do (tùy chọn)' })
  @ApiOkResponse({ type: RuleProposalDto })
  @ApiNotFoundResponse({ description: 'Không có đề xuất này trong nhà' })
  @ApiConflictResponse({ description: 'ALREADY_DECIDED' })
  reject(
    @CurrentMembership() membership: HouseMembership,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: RejectRuleProposalDto,
  ): Promise<RuleProposalDto> {
    return this.proposals.reject(membership, proposalId, dto.reason);
  }

  @Delete(':proposalId')
  @ApiParam({ name: 'proposalId', format: 'uuid' })
  @ApiOperation({ summary: 'Người đề xuất rút lại đề xuất đang chờ' })
  @ApiOkResponse({ type: RuleProposalDto })
  @ApiNotFoundResponse({ description: 'Không có đề xuất này trong nhà' })
  @ApiConflictResponse({ description: 'ALREADY_DECIDED' })
  withdraw(
    @CurrentMembership() membership: HouseMembership,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ): Promise<RuleProposalDto> {
    return this.proposals.withdraw(membership, proposalId);
  }
}

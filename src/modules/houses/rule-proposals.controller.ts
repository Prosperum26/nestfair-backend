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
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from './decorators/current-membership.decorator.js';
import { CreateRuleProposalDto, RejectRuleProposalDto, RuleProposalDto } from './dto/rule-proposal.dto.js';
import { type HouseMembership, HouseMemberGuard } from './guards/house-member.guard.js';
import { HouseRoles, HouseRolesGuard } from './guards/house-roles.guard.js';
import { RuleProposalsService } from './rule-proposals.service.js';

@ApiTags('rule-proposals')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house, or the action needs the admin role.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/rule-proposals')
export class RuleProposalsController {
  constructor(private readonly proposals: RuleProposalsService) {}

  @Get()
  @ApiOperation({
    summary: 'List rule proposals',
    description: 'Returns all rule proposals of the house, newest first, including decided and withdrawn ones. Every member can read them.',
  })
  @ApiOkResponse({ type: [RuleProposalDto], description: 'Proposals of the house.' })
  list(@CurrentMembership() membership: HouseMembership): Promise<RuleProposalDto[]> {
    return this.proposals.list(membership.houseId);
  }

  @Post()
  @ApiOperation({
    summary: 'Propose a rule change',
    description:
      'A member proposes adding, editing or removing one line of the house rules. A member may have at most 3 pending ' +
      'proposals. For EDIT and REMOVE the targeted line must still exist in the rules. The admin does not use this route ' +
      'because the admin edits the rules directly (`ADMIN_EDITS_DIRECTLY`). Broadcasts `rule_proposal:created`.',
  })
  @ApiCreatedResponse({ type: RuleProposalDto, description: 'The pending proposal.' })
  @ApiErrors(
    [400, 'Code `INVALID_PROPOSAL`: required text is missing for the kind, or the targeted rule is not in the rules.'],
    [403, 'Code `ADMIN_EDITS_DIRECTLY` for the admin, or the caller is not a member of this house.'],
    [409, 'Code `TOO_MANY_PENDING`: the caller already has 3 pending proposals.'],
  )
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
  @ApiParam({ name: 'proposalId', format: 'uuid', description: 'Id of the rule proposal.' })
  @ApiOperation({
    summary: 'Approve a rule proposal (admin)',
    description:
      'Approves a pending proposal and applies it to the house rules in the same transaction: ADD appends a line, EDIT replaces ' +
      'the first line that matches the stored target text, REMOVE deletes it. Admin only. Broadcasts `rule_proposal:decided`.',
  })
  @ApiOkResponse({ type: RuleProposalDto, description: 'The approved proposal.' })
  @ApiErrors(
    [404, 'The proposal does not exist in this house.'],
    [409, 'Codes: `ALREADY_DECIDED`; `RULE_CHANGED` (the targeted line was edited or removed since); `RULES_TOO_LONG` (the result would exceed 1000 characters).'],
  )
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
  @ApiParam({ name: 'proposalId', format: 'uuid', description: 'Id of the rule proposal.' })
  @ApiOperation({
    summary: 'Reject a rule proposal (admin)',
    description: 'Rejects a pending proposal with an optional reason that the proposer can read. The rules are not changed. Admin only. Broadcasts `rule_proposal:decided`.',
  })
  @ApiOkResponse({ type: RuleProposalDto, description: 'The rejected proposal.' })
  @ApiErrors([404, 'The proposal does not exist in this house.'], [409, 'Code `ALREADY_DECIDED`: the proposal is no longer pending.'])
  reject(
    @CurrentMembership() membership: HouseMembership,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: RejectRuleProposalDto,
  ): Promise<RuleProposalDto> {
    return this.proposals.reject(membership, proposalId, dto.reason);
  }

  @Delete(':proposalId')
  @ApiParam({ name: 'proposalId', format: 'uuid', description: 'Id of the rule proposal.' })
  @ApiOperation({
    summary: 'Withdraw my rule proposal',
    description: 'The author takes back a proposal that is still pending; its status becomes `WITHDRAWN`. Nobody else can withdraw it. Broadcasts `rule_proposal:decided`.',
  })
  @ApiOkResponse({ type: RuleProposalDto, description: 'The withdrawn proposal.' })
  @ApiErrors(
    [403, 'Code `NOT_PROPOSER`: only the author can withdraw.'],
    [404, 'The proposal does not exist in this house.'],
    [409, 'Code `ALREADY_DECIDED`: the proposal is no longer pending.'],
  )
  withdraw(
    @CurrentMembership() membership: HouseMembership,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ): Promise<RuleProposalDto> {
    return this.proposals.withdraw(membership, proposalId);
  }
}

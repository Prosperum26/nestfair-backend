import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_STRICT } from '../../common/throttle/throttle.config.js';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import type { UploadedImage } from '../uploads/image-validation.js';
import { CheckinService } from './checkin.service.js';
import { AssignmentDto } from './dto/assignment-response.dto.js';
import { OverrideAssignmentDto } from './dto/override-assignment.dto.js';
import { VerifyAssignmentDto } from './dto/verify-assignment.dto.js';
import { VerifyService } from './verify.service.js';

/** Giới hạn cứng của multer để không đọc file khổng lồ vào RAM; quy tắc 5MB nằm ở validateImageFile. */
const HARD_LIMIT_BYTES = 10 * 1024 * 1024;

/** Route theo ca trực, không có houseId trên URL: nhà được suy ra từ chính ca. */
@ApiTags('assignments')
@ApiBearerAuth()
@ApiErrors(
  401,
  [403, 'The assignment is not the caller\'s, the caller lacks the required role, or the caller has left the house.'],
  [404, 'The assignment does not exist (or belongs to a house the caller is not in).'],
  [429, 'Too many requests (20 per minute per client).'],
)
@ApiParam({ name: 'assignmentId', format: 'uuid', description: 'Id of the chore assignment. The house is derived from the assignment.' })
@UseGuards(JwtAuthGuard)
@Throttle(THROTTLE_STRICT)
@Controller('assignments/:assignmentId')
export class AssignmentActionsController {
  constructor(
    private readonly checkin: CheckinService,
    private readonly verifyService: VerifyService,
  ) {}

  @Post('checkin')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: HARD_LIMIT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Optional client-generated key. Retrying with the same key (network retry, double tap) never submits twice.' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: { photo: { type: 'string', format: 'binary', description: 'Proof photo: JPEG, PNG or WebP, up to 5 MB.' } },
    },
  })
  @ApiOperation({
    summary: 'Submit a proof photo (check-in)',
    description:
      'The assignee uploads a photo (multipart field `photo`) as proof the chore was done. The assignment moves from TODO ' +
      '(or REJECTED, for a resubmission) to PENDING_VERIFY and waits for a housemate to verify it. Check-in opens on the chore ' +
      'day and closes at the deadline plus the house grace period; a submission after the deadline is marked late. The same ' +
      'photo cannot be used for two assignments. Only the assignee can call it. Broadcasts `chore:submitted`.',
  })
  @ApiOkResponse({ type: AssignmentDto, description: 'The updated assignment, now PENDING_VERIFY.' })
  @ApiErrors(
    [400, 'Code `PROOF_REQUIRED`: no photo was sent.'],
    [409, 'Codes: `ASSIGNMENT_STATE_CHANGED` (no longer TODO / REJECTED), `PROOF_DUPLICATE` (photo already used), `ASSIGNMENT_DISPUTED` (waiting for the admin).'],
    [422, 'Codes: `CHECKIN_NOT_OPEN` (the chore day has not started), `CHECKIN_WINDOW_CLOSED` (the deadline and grace period passed).'],
    [503, 'Code `UPLOAD_UNAVAILABLE`: the image storage is not configured or failed.'],
  )
  doCheckin(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<AssignmentDto> {
    return this.checkin.checkin(user.id, assignmentId, file, idempotencyKey?.trim() || undefined);
  }

  @Patch('verify')
  @ApiOperation({
    summary: 'Verify or reject a submitted assignment',
    description:
      'A housemate other than the assignee approves or rejects a PENDING_VERIFY assignment. Approval completes it (DONE). ' +
      'Rejection needs a 5-200 character reason and sends it back (REJECTED) so the assignee can resubmit; after three rejections ' +
      'the assignment becomes disputed and the admin decides through the override endpoint. Two people verifying at once is ' +
      'safe: the second receives 409. Broadcasts `chore:verified`.',
  })
  @ApiOkResponse({ type: AssignmentDto, description: 'The updated assignment.' })
  @ApiErrors(
    [400, 'The decision is missing, or a REJECTED decision has no reason of 5-200 characters.'],
    [403, 'Code `SELF_VERIFY_FORBIDDEN`: members cannot verify their own assignment.'],
    [409, 'Code `ASSIGNMENT_STATE_CHANGED`: the assignment is not waiting for verification, or someone else just verified it.'],
  )
  verify(@CurrentUser() user: AuthUser, @Param('assignmentId') assignmentId: string, @Body() dto: VerifyAssignmentDto): Promise<AssignmentDto> {
    return this.verifyService.verify(user.id, assignmentId, dto);
  }

  @Post('appeal')
  @ApiOperation({
    summary: 'Appeal a rejection',
    description: 'The assignee contests a rejection they consider unfair. The assignment is flagged `disputed` and the admin decides through the override endpoint. Only possible while the assignment is REJECTED.',
  })
  @ApiOkResponse({ type: AssignmentDto, description: 'The assignment, now disputed.' })
  @ApiErrors([409, 'Code `ASSIGNMENT_STATE_CHANGED`: the assignment is not in the REJECTED state.'])
  appeal(@CurrentUser() user: AuthUser, @Param('assignmentId') assignmentId: string): Promise<AssignmentDto> {
    return this.verifyService.appeal(user.id, assignmentId);
  }

  @Patch('override')
  @ApiOperation({
    summary: 'Override an assignment (admin)',
    description:
      'The admin intervenes on a single assignment: `FORCE_DONE` marks it done, `FORCE_REJECT` rejects its proof, `REASSIGN` ' +
      'gives it to another active member (`userId`), `CANCEL` cancels it. A reason of 5-200 characters is mandatory and every ' +
      'override is written to the chore audit log. This is also how disputed assignments are resolved. Broadcasts ' +
      '`chore:verified`, `chore:reassigned` or `chore:cancelled`.',
  })
  @ApiOkResponse({ type: AssignmentDto, description: 'The updated assignment.' })
  @ApiErrors(
    [400, 'Invalid action or reason, or code `NOT_ELIGIBLE_ASSIGNEE` (the new assignee is not in the house).'],
    [409, 'Code `ASSIGNMENT_STATE_CHANGED`: the action does not apply in the assignment\'s current state.'],
    [422, 'Code `DUPLICATE_CHORE_SAME_DAY`: the new assignee would have the same chore twice on that day.'],
  )
  override(@CurrentUser() user: AuthUser, @Param('assignmentId') assignmentId: string, @Body() dto: OverrideAssignmentDto): Promise<AssignmentDto> {
    return this.verifyService.override(user.id, assignmentId, dto);
  }
}

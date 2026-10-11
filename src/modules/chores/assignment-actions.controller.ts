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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
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
@ApiTags('chores')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải ca của bạn / không đủ quyền / đã rời nhà' })
@ApiNotFoundResponse({ description: 'Không tìm thấy ca trực (hoặc ca của nhà khác)' })
@ApiParam({ name: 'assignmentId', format: 'uuid' })
@UseGuards(JwtAuthGuard)
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
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Retry mạng / bấm đúp với cùng key không nộp hai lần' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: { photo: { type: 'string', format: 'binary', description: 'JPG/PNG/WEBP, tối đa 5MB' } },
    },
  })
  @ApiOperation({ summary: 'Người được giao nộp ảnh minh chứng, chờ bạn cùng phòng duyệt' })
  @ApiOkResponse({ type: AssignmentDto })
  @ApiBadRequestResponse({ description: 'PROOF_REQUIRED: thiếu ảnh' })
  @ApiConflictResponse({ description: 'ASSIGNMENT_STATE_CHANGED | PROOF_DUPLICATE | ASSIGNMENT_DISPUTED' })
  @ApiUnprocessableEntityResponse({ description: 'CHECKIN_NOT_OPEN | CHECKIN_WINDOW_CLOSED' })
  @ApiServiceUnavailableResponse({ description: 'UPLOAD_UNAVAILABLE: chưa cấu hình / lỗi Cloudinary' })
  doCheckin(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<AssignmentDto> {
    return this.checkin.checkin(user.id, assignmentId, file, idempotencyKey?.trim() || undefined);
  }

  @Patch('verify')
  @ApiOperation({ summary: 'Bạn cùng phòng duyệt hoặc từ chối ca đã nộp (không tự duyệt ca của mình)' })
  @ApiOkResponse({ type: AssignmentDto })
  @ApiBadRequestResponse({ description: 'Thiếu quyết định, hoặc REJECTED không có lý do (5–200 ký tự)' })
  @ApiConflictResponse({ description: 'ASSIGNMENT_STATE_CHANGED: ca không ở trạng thái chờ duyệt hoặc vừa được người khác duyệt' })
  verify(@CurrentUser() user: AuthUser, @Param('assignmentId') assignmentId: string, @Body() dto: VerifyAssignmentDto): Promise<AssignmentDto> {
    return this.verifyService.verify(user.id, assignmentId, dto);
  }

  @Post('appeal')
  @ApiOperation({ summary: 'Người làm khiếu nại khi nghĩ bị từ chối oan: chuyển ca sang disputed cho trưởng phòng quyết' })
  @ApiOkResponse({ type: AssignmentDto })
  @ApiConflictResponse({ description: 'Ca không ở trạng thái bị từ chối' })
  appeal(@CurrentUser() user: AuthUser, @Param('assignmentId') assignmentId: string): Promise<AssignmentDto> {
    return this.verifyService.appeal(user.id, assignmentId);
  }

  @Patch('override')
  @ApiOperation({ summary: 'Trưởng phòng can thiệp từng ca: FORCE_DONE, FORCE_REJECT, REASSIGN, CANCEL (có nhật ký)' })
  @ApiOkResponse({ type: AssignmentDto })
  @ApiBadRequestResponse({ description: 'Hành động/lý do không hợp lệ, hoặc người nhận ca không hợp lệ' })
  @ApiConflictResponse({ description: 'ASSIGNMENT_STATE_CHANGED: hành động không áp dụng được ở trạng thái hiện tại' })
  override(@CurrentUser() user: AuthUser, @Param('assignmentId') assignmentId: string, @Body() dto: OverrideAssignmentDto): Promise<AssignmentDto> {
    return this.verifyService.override(user.id, assignmentId, dto);
  }
}

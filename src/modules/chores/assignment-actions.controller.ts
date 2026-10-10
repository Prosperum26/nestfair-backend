import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import type { UploadedImage } from '../uploads/image-validation.js';
import { AssignmentsService } from './assignments.service.js';
import { AssignmentDto } from './dto/assignment-response.dto.js';

/** Giới hạn cứng của multer để không đọc file khổng lồ vào RAM; quy tắc 5MB nằm ở validateImageFile. */
const HARD_LIMIT_BYTES = 10 * 1024 * 1024;

/** Route theo ca trực, không có houseId trên URL: nhà được suy ra từ chính ca. */
@ApiTags('chores')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({
  description: 'Không phải thành viên nhà này, hoặc không phải ca của bạn',
})
@ApiNotFoundResponse({ description: 'Không tìm thấy ca trực' })
@ApiParam({ name: 'assignmentId', format: 'uuid' })
@UseGuards(JwtAuthGuard)
@Controller('assignments/:assignmentId')
export class AssignmentActionsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post('checkin')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: HARD_LIMIT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: {
        photo: {
          type: 'string',
          format: 'binary',
          description: 'JPG/PNG/WEBP, tối đa 5MB',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Người được giao nộp ảnh minh chứng, chờ bạn cùng phòng duyệt',
  })
  @ApiOkResponse({ type: AssignmentDto })
  @ApiBadRequestResponse({
    description: 'Thiếu ảnh, sai định dạng hoặc quá 5MB',
  })
  @ApiConflictResponse({ description: 'Ca đã nộp, đã duyệt hoặc đã quá hạn' })
  @ApiServiceUnavailableResponse({ description: 'Chưa cấu hình Cloudinary' })
  checkin(
    @CurrentUser() user: AuthUser,
    @Param('assignmentId') assignmentId: string,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<AssignmentDto> {
    return this.assignments.checkin(user.id, assignmentId, file);
  }
}

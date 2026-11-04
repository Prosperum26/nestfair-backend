import {
  Body,
  Controller,
  Delete,
  Get,
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
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { PublicUserDto } from '../auth/dto/auth-response.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import type { UploadedImage } from '../uploads/image-validation.js';
import { UpdateAssistantConsentDto } from './dto/update-assistant-consent.dto.js';
import { UpdateNotificationPrefsDto } from './dto/update-notification-prefs.dto.js';
import { UpdateOcrConsentDto } from './dto/update-ocr-consent.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UsersService } from './users.service.js';

/** Giới hạn cứng của multer; giới hạn 5MB và kiểm tra định dạng nằm ở validateImageFile. */
const HARD_LIMIT_BYTES = 10 * 1024 * 1024;

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
  @ApiBadRequestResponse({
    description: 'Sai định dạng hoặc thiếu cặp ngân hàng / STK',
  })
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<PublicUserDto> {
    return this.users.updateMe(user.id, dto);
  }

  @Patch('me/notifications')
  @ApiOperation({ summary: 'Bật / tắt thông báo (chỉ khóa có gửi mới đổi)' })
  @ApiOkResponse({ type: PublicUserDto })
  @ApiBadRequestResponse({ description: 'Giá trị không phải true/false hoặc khóa lạ' })
  setNotifications(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateNotificationPrefsDto,
  ): Promise<PublicUserDto> {
    return this.users.setNotificationPrefs(user.id, dto);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', { limits: { fileSize: HARD_LIMIT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['avatar'],
      properties: {
        avatar: { type: 'string', format: 'binary', description: 'Ảnh JPG/PNG/WEBP, tối đa 5MB (client nén trước khi gửi)' },
      },
    },
  })
  @ApiOperation({ summary: 'Đổi ảnh đại diện (thay ảnh cũ trên Cloudinary)' })
  @ApiOkResponse({ type: PublicUserDto })
  @ApiBadRequestResponse({ description: 'AVATAR_REQUIRED: thiếu file' })
  setAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<PublicUserDto> {
    return this.users.setAvatar(user.id, file);
  }

  @Delete('me/avatar')
  @ApiOperation({ summary: 'Xóa ảnh đại diện' })
  @ApiOkResponse({ type: PublicUserDto })
  removeAvatar(@CurrentUser() user: AuthUser): Promise<PublicUserDto> {
    return this.users.removeAvatar(user.id);
  }

  @Patch('me/ocr-consent')
  @ApiOperation({
    summary:
      'Đồng ý / rút lại việc gửi ảnh hóa đơn tới Google Gemini (bắt buộc đồng ý mới quét OCR được)',
  })
  @ApiOkResponse({ type: PublicUserDto })
  @ApiBadRequestResponse({ description: 'enabled không phải true/false' })
  setOcrConsent(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateOcrConsentDto,
  ): Promise<PublicUserDto> {
    return this.users.setOcrConsent(user.id, dto.enabled);
  }

  @Patch('me/assistant-consent')
  @ApiOperation({
    summary:
      'Đồng ý / rút lại việc gửi nội dung chat tới Google Gemini cho Trợ lý AI (bắt buộc đồng ý mới chat được)',
  })
  @ApiOkResponse({ type: PublicUserDto })
  @ApiBadRequestResponse({ description: 'enabled không phải true/false' })
  setAssistantConsent(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAssistantConsentDto,
  ): Promise<PublicUserDto> {
    return this.users.setAssistantConsent(user.id, dto.enabled);
  }
}

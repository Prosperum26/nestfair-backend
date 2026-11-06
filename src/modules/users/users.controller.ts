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
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
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
@ApiErrors(401)
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get my profile',
    description:
      'Returns the signed-in user\'s profile (same payload as `GET /auth/me`): contact details, bank account for QR payments, ' +
      'avatar, AI-consent timestamps and notification preferences.',
  })
  @ApiOkResponse({ type: PublicUserDto, description: 'The current user.' })
  getMe(@CurrentUser() user: AuthUser): Promise<PublicUserDto> {
    return this.users.getMe(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Update my profile',
    description:
      'Partial update: only the fields that are sent change. Editable fields are the full name, the phone number and the bank ' +
      'account used to receive money (`bankBin` and `bankAccount` must be set together or cleared together). Send null for ' +
      '`phone`, `bankBin` and `bankAccount` to clear them. Email and password cannot be changed here; unknown fields are ' +
      'rejected with 400.',
  })
  @ApiOkResponse({ type: PublicUserDto, description: 'The updated profile.' })
  @ApiErrors([400, 'Invalid format, or only one of `bankBin` / `bankAccount` was provided.'])
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<PublicUserDto> {
    return this.users.updateMe(user.id, dto);
  }

  @Patch('me/notifications')
  @ApiOperation({
    summary: 'Update notification preferences',
    description:
      'Turns notification categories on or off. Only the keys that are sent change; the others keep their value. Keys: ' +
      '`expenseCreated`, `choreDigest`, `debtPaid`.',
  })
  @ApiOkResponse({ type: PublicUserDto, description: 'The profile with the new preferences.' })
  @ApiErrors([400, 'A value is not a boolean, or an unknown key was sent.'])
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
        avatar: { type: 'string', format: 'binary', description: 'JPEG, PNG or WebP image up to 5 MB (the web client compresses before upload).' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload my avatar',
    description:
      'Uploads a new avatar image (multipart field `avatar`) to Cloudinary and stores its URL on the profile. The new image ' +
      'is saved before the old one is deleted, so a failure never leaves the user without an avatar; an old avatar that is ' +
      'not hosted by NestFair (for example a Google photo) is left alone. Only JPEG, PNG and WebP up to 5 MB are accepted.',
  })
  @ApiOkResponse({ type: PublicUserDto, description: 'The profile with the new `avatarUrl`.' })
  @ApiErrors([400, 'Code `AVATAR_REQUIRED`: no file was sent.'], 413, 415)
  setAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<PublicUserDto> {
    return this.users.setAvatar(user.id, file);
  }

  @Delete('me/avatar')
  @ApiOperation({
    summary: 'Remove my avatar',
    description: 'Clears the avatar URL and deletes the stored image from Cloudinary. Does nothing if the user has no avatar.',
  })
  @ApiOkResponse({ type: PublicUserDto, description: 'The profile with `avatarUrl` set to null.' })
  removeAvatar(@CurrentUser() user: AuthUser): Promise<PublicUserDto> {
    return this.users.removeAvatar(user.id);
  }

  @Patch('me/ocr-consent')
  @ApiOperation({
    summary: 'Set receipt-scan (OCR) consent',
    description:
      'Records or withdraws the user\'s consent to send receipt photos to Google Gemini. Scanning a receipt is refused with ' +
      '`OCR_CONSENT_REQUIRED` until the user consents. Sets `ocrConsentAt` to now, or to null when withdrawn.',
  })
  @ApiOkResponse({ type: PublicUserDto, description: 'The profile with the updated `ocrConsentAt`.' })
  @ApiErrors([400, '`enabled` is missing or not a boolean.'])
  setOcrConsent(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateOcrConsentDto,
  ): Promise<PublicUserDto> {
    return this.users.setOcrConsent(user.id, dto.enabled);
  }

  @Patch('me/assistant-consent')
  @ApiOperation({
    summary: 'Set AI assistant consent',
    description:
      'Records or withdraws the user\'s consent to send assistant chat text to Google Gemini. Chatting is refused with ' +
      '`ASSISTANT_CONSENT_REQUIRED` until the user consents. Sets `assistantConsentAt` to now, or to null when withdrawn. ' +
      'Independent of the receipt-scan consent.',
  })
  @ApiOkResponse({ type: PublicUserDto, description: 'The profile with the updated `assistantConsentAt`.' })
  @ApiErrors([400, '`enabled` is missing or not a boolean.'])
  setAssistantConsent(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAssistantConsentDto,
  ): Promise<PublicUserDto> {
    return this.users.setAssistantConsent(user.id, dto.enabled);
  }
}

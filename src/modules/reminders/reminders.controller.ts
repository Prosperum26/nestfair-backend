import {
  Body,
  Controller,
  Delete,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthUser } from '../auth/strategies/jwt.strategy.js';
import { CreateReminderDto } from './dto/create-reminder.dto.js';
import { ListRemindersQuery } from './dto/list-reminders.query.js';
import { ReminderDto } from './dto/reminder.dto.js';
import { UpdateReminderDto } from './dto/update-reminder.dto.js';
import { RemindersService } from './reminders.service.js';

/**
 * Nhắc nhở việc cá nhân (Issue #12). User-scoped như users: mọi route chỉ đọc/sửa/xóa nhắc của
 * CHÍNH người gọi (userId từ JWT, gom mọi nhà); không bao giờ thấy nhắc của người khác, kể cả
 * bạn cùng phòng. houseId chỉ có trong body khi tạo và được tự kiểm tra membership (chống IDOR).
 */
@ApiTags('reminders')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@UseGuards(JwtAuthGuard)
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  @ApiOperation({
    summary: 'Danh sách nhắc nhở của CHÍNH MÌNH (mọi nhà)',
    description:
      '`state=upcoming` (mặc định) chỉ trả nhắc chưa gửi (sentAt null); `state=all` trả mọi nhắc kể cả đã gửi. ' +
      'Cả hai xếp remindAt tăng dần.',
  })
  @ApiOkResponse({ type: [ReminderDto], description: 'Mảng thẳng ReminderDto[]' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListRemindersQuery): Promise<ReminderDto[]> {
    return this.reminders.list(user.id, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Tạo nhắc nhở',
    description:
      'Tự tạo (source USER), hoặc từ nút gợi ý CREATE_REMINDER của Trợ lý: gửi đủ sourceMessageId + actionIndex ' +
      '→ source ASSISTANT, chống bấm hai lần bằng dedupeKey (409). remindAt phải sau hiện tại và trong vòng 1 năm.',
  })
  @ApiCreatedResponse({ type: ReminderDto })
  @ApiBadRequestResponse({
    description: 'REMIND_AT_INVALID | REMINDER_SOURCE_INVALID | REMINDER_ACTION_INVALID | sai định dạng field',
  })
  @ApiForbiddenResponse({ description: 'Không phải thành viên còn hoạt động của houseId trong body' })
  @ApiNotFoundResponse({ description: 'MESSAGE_NOT_FOUND (sourceMessageId không tồn tại hoặc không phải của mình)' })
  @ApiConflictResponse({ description: 'REMINDER_ALREADY_CREATED (đã tạo nhắc cho nút gợi ý này rồi)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReminderDto): Promise<ReminderDto> {
    return this.reminders.create(user.id, dto);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Sửa nhắc nhở của mình (tiêu đề, giờ nhắc)',
    description:
      'Chỉ nhắc chưa gửi mới sửa được (đã gửi → 409 REMINDER_ALREADY_SENT). Nhắc SYSTEM vẫn sửa được giờ (D12). ' +
      'Đổi remindAt thì phải vẫn sau hiện tại và trong vòng 1 năm.',
  })
  @ApiOkResponse({ type: ReminderDto })
  @ApiBadRequestResponse({ description: 'REMIND_AT_INVALID | sai định dạng field' })
  @ApiNotFoundResponse({ description: 'REMINDER_NOT_FOUND (không có hoặc không phải của mình)' })
  @ApiConflictResponse({ description: 'REMINDER_ALREADY_SENT (nhắc đã gửi rồi)' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReminderDto,
  ): Promise<ReminderDto> {
    return this.reminders.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Xóa nhắc nhở của mình',
    description:
      'Nhắc đã gửi vẫn xóa được (dọn lịch sử). Nhắc SYSTEM không xóa được (D12: hệ thống chỉ cho sửa) → 403.',
  })
  @ApiOkResponse({ schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } })
  @ApiNotFoundResponse({ description: 'REMINDER_NOT_FOUND (không có hoặc không phải của mình)' })
  @ApiForbiddenResponse({ description: 'REMINDER_NOT_DELETABLE (nhắc của hệ thống)' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    return this.reminders.remove(user.id, id);
  }
}

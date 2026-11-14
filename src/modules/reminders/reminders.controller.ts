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
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
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
@ApiErrors(401)
@UseGuards(JwtAuthGuard)
@Controller('reminders')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Get()
  @ApiOperation({
    summary: 'List my reminders',
    description:
      'Returns the caller\'s own reminders across all of their houses; reminders are personal and never visible to housemates. ' +
      '`state=upcoming` (default) returns only reminders not sent yet (`sentAt` is null), `state=all` also returns the ones already delivered. Both are sorted by `remindAt` ascending. ' +
      'The response is a plain array. Read-only.',
  })
  @ApiOkResponse({ type: [ReminderDto], description: 'The caller\'s reminders.' })
  @ApiErrors([400, '`state` is not `upcoming` or `all`, or `limit` is out of range.'])
  list(@CurrentUser() user: AuthUser, @Query() query: ListRemindersQuery): Promise<ReminderDto[]> {
    return this.reminders.list(user.id, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a reminder',
    description:
      'Creates a personal reminder that fires at `remindAt` (it must be in the future and within one year) and is delivered as the socket event `reminder:due` to the caller only. ' +
      'A reminder made directly by the user has source USER. To turn an assistant suggestion into a reminder, send `sourceMessageId` together with `actionIndex` (the position of the ' +
      '`CREATE_REMINDER` button); the reminder then has source ASSISTANT, and pressing the same button twice is refused with 409. The caller must be an active member of the given house, ' +
      'which the server verifies.',
  })
  @ApiCreatedResponse({ type: ReminderDto, description: 'The created reminder.' })
  @ApiErrors(
    [400, 'Codes `REMIND_AT_INVALID`, `REMINDER_SOURCE_INVALID` (only one of `sourceMessageId` and `actionIndex` given), `REMINDER_ACTION_INVALID` (the button is not a reminder action) or a field format error.'],
    [403, 'The caller is not an active member of the house in the body.'],
    [404, 'Code `MESSAGE_NOT_FOUND`: the assistant message does not exist or is not the caller\'s.'],
    [409, 'Code `REMINDER_ALREADY_CREATED`: a reminder was already created from this button.'],
  )
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReminderDto): Promise<ReminderDto> {
    return this.reminders.create(user.id, dto);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Id of the reminder to edit.' })
  @ApiOperation({
    summary: 'Edit my reminder',
    description:
      'Changes the text and/or the time of one of the caller\'s reminders; only the fields sent are updated. A reminder that was already delivered can no longer be edited (409). ' +
      'The time of a SYSTEM reminder may be changed too. A new `remindAt` must still be in the future and within one year.',
  })
  @ApiOkResponse({ type: ReminderDto, description: 'The updated reminder.' })
  @ApiErrors(
    [400, 'Code `REMIND_AT_INVALID` or a field format error (the title cannot be empty or null).'],
    [404, 'Code `REMINDER_NOT_FOUND`: no such reminder for the caller.'],
    [409, 'Code `REMINDER_ALREADY_SENT`: the reminder was already delivered.'],
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReminderDto,
  ): Promise<ReminderDto> {
    return this.reminders.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Id of the reminder to delete.' })
  @ApiOperation({
    summary: 'Delete my reminder',
    description: 'Deletes one of the caller\'s reminders. Delivered reminders can be deleted too, which cleans up the history. Reminders created by the system (source SYSTEM) can be edited but not deleted.',
  })
  @ApiOkResponse({ description: 'The reminder was deleted.', schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } })
  @ApiErrors(
    [403, 'Code `REMINDER_NOT_DELETABLE`: system reminders cannot be deleted.'],
    [404, 'Code `REMINDER_NOT_FOUND`: no such reminder for the caller.'],
  )
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    return this.reminders.remove(user.id, id);
  }
}

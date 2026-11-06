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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/swagger/api-errors.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentMembership } from '../houses/decorators/current-membership.decorator.js';
import { type HouseMembership, HouseMemberGuard } from '../houses/guards/house-member.guard.js';
import type { UploadedImage } from '../uploads/image-validation.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { ExpenseDto, ExpenseSummaryDto, UploadedUrlDto } from './dto/expense-response.dto.js';
import { ListExpensesQuery, MonthQuery } from './dto/list-expenses.query.js';
import { UpdateExpenseDto } from './dto/update-expense.dto.js';
import { ExpensesService } from './expenses.service.js';

/** Multer chặn cứng ở 10MB; validateImageFile trả lỗi 413 thân thiện ở mốc 5MB. */
const HARD_LIMIT_BYTES = 10 * 1024 * 1024;

const SPLIT_ERRORS =
  'Codes `SPLIT_INVALID` (the split does not fit the chosen type), `SPLIT_SUM_MISMATCH` (EXACT amounts do not add up to the total), `NOT_A_HOUSE_MEMBER` (a payer or participant is not in the house), `SPENT_AT_IN_FUTURE` or `RECEIPT_URL_INVALID`.';

@ApiTags('expenses')
@ApiBearerAuth()
@ApiErrors(401, [403, 'The caller is not an active member of this house.'])
@ApiParam({ name: 'houseId', format: 'uuid', description: 'Id of the house.' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @ApiOperation({
    summary: 'List expenses of a month',
    description:
      'Returns the expenses of one calendar month (Vietnam time), newest first, each with its splits, items, the caller\'s own share and a `canEdit` flag. ' +
      'Optional filters narrow the list by payer, by category or by a search text matched against the title and the payer\'s name. Read-only.',
  })
  @ApiOkResponse({ type: [ExpenseDto], description: 'Expenses of the month matching the filters.' })
  @ApiErrors([400, '`month` is not YYYY-MM, or a filter value is invalid.'])
  list(@CurrentMembership() m: HouseMembership, @Query() query: ListExpensesQuery): Promise<ExpenseDto[]> {
    return this.expenses.list(m, query);
  }

  // Khai báo trước ':expenseId' để route động không bắt mất.
  @Get('summary')
  @ApiOperation({
    summary: 'Get the monthly summary',
    description:
      'Aggregates one month: the total spent by the house, how much the caller paid up front, the caller\'s own share, the difference between the two ' +
      '(positive = owed back, negative = owes) and a per-category breakdown. This is a per-month figure; the running balance across months comes from ' +
      '`GET /houses/{houseId}/settlements/plan`. Read-only.',
  })
  @ApiOkResponse({ type: ExpenseSummaryDto, description: 'The month summary.' })
  @ApiErrors([400, '`month` is not in the format YYYY-MM.'])
  summary(@CurrentMembership() m: HouseMembership, @Query() query: MonthQuery): Promise<ExpenseSummaryDto> {
    return this.expenses.summary(m, query.month);
  }

  @Post()
  @ApiOperation({
    summary: 'Record an expense and split it',
    description:
      'Records a shared expense paid up front by one member (the caller by default) and divides it among the members. ' +
      'Money is integer VND and the stored shares always add up exactly to the total: an uneven remainder is spread one dong at a time from the first member in the list. ' +
      'Split types: `EQUAL` (all active members), `CUSTOM` (equal among `participantIds`), `EXACT` (explicit `splits`, which must sum to the total) and ' +
      '`ITEMIZED` (by receipt `items`; the difference between the total and the items, such as a discount or fee, is shared in proportion to each member\'s items). ' +
      'To save a receipt read by OCR, pass the draft\'s `receiptScanId`; the draft is then consumed and cannot be used twice. VAT is never split out: only the total paid is recorded. ' +
      'Broadcasts `expense:new` after the transaction commits.',
  })
  @ApiCreatedResponse({ type: ExpenseDto, description: 'The recorded expense with its splits.' })
  @ApiErrors(
    [400, 'Invalid body (unknown field, wrong type or out-of-range value).'],
    [404, 'Code `RECEIPT_SCAN_NOT_FOUND`: the OCR draft does not exist or belongs to another house.'],
    [409, 'Code `RECEIPT_SCAN_USED`: the OCR draft was already turned into an expense.'],
    [422, SPLIT_ERRORS],
  )
  create(@CurrentMembership() m: HouseMembership, @Body() dto: CreateExpenseDto): Promise<ExpenseDto> {
    return this.expenses.create(m, dto);
  }

  @Post('receipt-image')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: HARD_LIMIT_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: { photo: { type: 'string', format: 'binary', description: 'Receipt photo: JPEG, PNG or WebP, up to 5 MB.' } },
    },
  })
  @ApiOperation({
    summary: 'Upload a receipt photo',
    description:
      'Uploads one receipt photo (multipart field `photo`; JPEG, PNG or WebP, up to 5 MB) to image storage and returns its HTTPS URL. ' +
      'Pass the URL as `receiptImageUrl` when creating or editing an expense; URLs not issued by this endpoint are refused. ' +
      'To have the receipt read automatically use the scan endpoint instead.',
  })
  @ApiCreatedResponse({ type: UploadedUrlDto, description: 'The stored image URL.' })
  @ApiErrors(
    [400, 'Code `PROOF_REQUIRED`: no `photo` file was sent.'],
    [413, 'Code `IMAGE_TOO_LARGE`: the image is larger than 5 MB.'],
    [415, 'Code `UNSUPPORTED_IMAGE`: the file is not a JPEG, PNG or WebP image.'],
    [503, 'Code `UPLOAD_UNAVAILABLE`: image storage is not configured or failed.'],
  )
  uploadReceipt(@CurrentMembership() m: HouseMembership, @UploadedFile() file: UploadedImage | undefined): Promise<UploadedUrlDto> {
    return this.expenses.uploadReceipt(m, file);
  }

  @Get(':expenseId')
  @ApiOperation({
    summary: 'Get one expense',
    description: 'Returns a single expense of the house with its splits, items, the caller\'s share and the `canEdit` flag. Read-only.',
  })
  @ApiParam({ name: 'expenseId', format: 'uuid', description: 'Id of the expense.' })
  @ApiOkResponse({ type: ExpenseDto, description: 'The expense.' })
  @ApiErrors([404, 'Code `EXPENSE_NOT_FOUND`: no such expense in this house.'])
  get(@CurrentMembership() m: HouseMembership, @Param('expenseId', ParseUUIDPipe) id: string): Promise<ExpenseDto> {
    return this.expenses.get(m, id);
  }

  @Patch(':expenseId')
  @ApiOperation({
    summary: 'Edit an expense',
    description:
      'Partial update by the payer, the member who recorded the expense, or the house admin. Changing the total, split type, participants, splits or items ' +
      'recomputes the shares (an ITEMIZED expense must send `items` again); changing only the title, category, date, note or photo keeps the existing shares. ' +
      '`receiptScanId` cannot be changed after creation. Balances update immediately. Broadcasts `expense:updated`.',
  })
  @ApiParam({ name: 'expenseId', format: 'uuid', description: 'Id of the expense to edit.' })
  @ApiOkResponse({ type: ExpenseDto, description: 'The updated expense.' })
  @ApiErrors(
    [400, 'Invalid body, including `receiptScanId`, which is not allowed on update.'],
    [403, 'Code `EXPENSE_FORBIDDEN`: only the payer, the creator or the admin may edit.'],
    [404, 'Code `EXPENSE_NOT_FOUND`.'],
    [422, SPLIT_ERRORS],
  )
  update(
    @CurrentMembership() m: HouseMembership,
    @Param('expenseId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ): Promise<ExpenseDto> {
    return this.expenses.update(m, id, dto);
  }

  @Delete(':expenseId')
  @ApiOperation({
    summary: 'Delete an expense',
    description: 'Removes the expense and all of its splits, so balances are recomputed without it. Allowed for the payer, the member who recorded it, or the house admin. Broadcasts `expense:deleted`.',
  })
  @ApiParam({ name: 'expenseId', format: 'uuid', description: 'Id of the expense to delete.' })
  @ApiOkResponse({ description: 'The expense was deleted.', schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } })
  @ApiErrors([403, 'Code `EXPENSE_FORBIDDEN`: only the payer, the creator or the admin may delete.'], [404, 'Code `EXPENSE_NOT_FOUND`.'])
  remove(@CurrentMembership() m: HouseMembership, @Param('expenseId', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    return this.expenses.remove(m, id);
  }
}

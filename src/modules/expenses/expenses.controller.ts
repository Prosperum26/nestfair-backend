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
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
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
  'SPLIT_INVALID | SPLIT_SUM_MISMATCH | NOT_A_HOUSE_MEMBER | SPENT_AT_IN_FUTURE | RECEIPT_URL_INVALID';

@ApiTags('expenses')
@ApiBearerAuth()
@ApiUnauthorizedResponse()
@ApiForbiddenResponse({ description: 'Không phải thành viên nhà này (hoặc không đủ quyền)' })
@ApiParam({ name: 'houseId', format: 'uuid' })
@UseGuards(JwtAuthGuard, HouseMemberGuard)
@Controller('houses/:houseId/expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @ApiOperation({ summary: 'Sổ chi theo tháng (giờ VN), lọc theo người trả / danh mục / từ khóa' })
  @ApiOkResponse({ type: [ExpenseDto] })
  list(@CurrentMembership() m: HouseMembership, @Query() query: ListExpensesQuery): Promise<ExpenseDto[]> {
    return this.expenses.list(m, query);
  }

  // Khai báo trước ':expenseId' để route động không bắt mất.
  @Get('summary')
  @ApiOperation({ summary: 'Thống kê tháng: tổng chi, bạn đã trả, phần của bạn, theo danh mục' })
  @ApiOkResponse({ type: ExpenseSummaryDto })
  summary(@CurrentMembership() m: HouseMembership, @Query() query: MonthQuery): Promise<ExpenseSummaryDto> {
    return this.expenses.summary(m, query.month);
  }

  @Post()
  @ApiOperation({ summary: 'Ghi khoản chi và chia tiền (EQUAL / CUSTOM / EXACT / ITEMIZED). Phát `expense:new`.' })
  @ApiCreatedResponse({ type: ExpenseDto })
  @ApiUnprocessableEntityResponse({ description: SPLIT_ERRORS })
  @ApiNotFoundResponse({ description: 'RECEIPT_SCAN_NOT_FOUND: bản nháp OCR không có hoặc thuộc nhà khác' })
  @ApiConflictResponse({ description: 'RECEIPT_SCAN_USED: bản nháp OCR đã được dùng cho một khoản chi' })
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
      properties: { photo: { type: 'string', format: 'binary', description: 'JPG/PNG/WEBP, tối đa 5MB' } },
    },
  })
  @ApiOperation({ summary: 'Tải ảnh hóa đơn lên, trả URL để gắn vào khoản chi' })
  @ApiCreatedResponse({ type: UploadedUrlDto })
  @ApiServiceUnavailableResponse({ description: 'UPLOAD_UNAVAILABLE: chưa cấu hình / lỗi Cloudinary' })
  uploadReceipt(@CurrentMembership() m: HouseMembership, @UploadedFile() file: UploadedImage | undefined): Promise<UploadedUrlDto> {
    return this.expenses.uploadReceipt(m, file);
  }

  @Get(':expenseId')
  @ApiOperation({ summary: 'Chi tiết một khoản chi' })
  @ApiOkResponse({ type: ExpenseDto })
  @ApiNotFoundResponse({ description: 'EXPENSE_NOT_FOUND' })
  get(@CurrentMembership() m: HouseMembership, @Param('expenseId', ParseUUIDPipe) id: string): Promise<ExpenseDto> {
    return this.expenses.get(m, id);
  }

  @Patch(':expenseId')
  @ApiOperation({ summary: 'Sửa khoản chi (người trả, người ghi hoặc trưởng phòng). Đổi tiền / kiểu chia thì chia lại.' })
  @ApiOkResponse({ type: ExpenseDto })
  @ApiNotFoundResponse({ description: 'EXPENSE_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({ description: SPLIT_ERRORS })
  update(
    @CurrentMembership() m: HouseMembership,
    @Param('expenseId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
  ): Promise<ExpenseDto> {
    return this.expenses.update(m, id, dto);
  }

  @Delete(':expenseId')
  @ApiOperation({ summary: 'Xóa khoản chi (người trả, người ghi hoặc trưởng phòng)' })
  @ApiOkResponse({ schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } })
  @ApiNotFoundResponse({ description: 'EXPENSE_NOT_FOUND' })
  remove(@CurrentMembership() m: HouseMembership, @Param('expenseId', ParseUUIDPipe) id: string): Promise<{ ok: true }> {
    return this.expenses.remove(m, id);
  }
}

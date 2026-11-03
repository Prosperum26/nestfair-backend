import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateExpenseDto } from './create-expense.dto.js';

/**
 * Sửa một phần. Đổi `totalAmount`, `splitType`, `participantIds`, `splits` hoặc `items` thì phần chia được tính lại
 * (khoản ITEMIZED phải gửi lại `items`); chỉ đổi tên, danh mục, ngày, ghi chú, ảnh thì giữ nguyên phần chia.
 * `receiptScanId` chỉ gắn lúc tạo nên bị loại khỏi DTO này (gửi lên sẽ bị 400).
 */
export class UpdateExpenseDto extends PartialType(OmitType(CreateExpenseDto, ['receiptScanId'] as const)) {}

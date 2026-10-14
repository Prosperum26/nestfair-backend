import { PartialType } from '@nestjs/swagger';
import { CreateExpenseDto } from './create-expense.dto.js';

/**
 * Sửa một phần. Đổi `totalAmount`, `splitType`, `participantIds` hoặc `splits` thì phần chia được tính lại;
 * chỉ đổi tên, danh mục, ngày, ghi chú, ảnh thì giữ nguyên phần chia.
 */
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}

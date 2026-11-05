import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { computeNetBalances, type DebtExpense, type DebtSettlement } from './algorithms/min-cash-flow.js';

export interface Ledger {
  expenses: DebtExpense[];
  settlements: (DebtSettlement & { id: string; createdAt: Date; proofUrl: string | null })[];
  /**
   * Dòng điều chỉnh khi trưởng phòng xóa người còn nợ / chưa nhận khỏi nhà (BalanceAdjustmentLine).
   * Tác dụng y như settlement đã xác nhận, nên đưa thẳng vào số dư và nợ chéo.
   */
  adjustments: DebtSettlement[];
}

/** Settlement + điều chỉnh: mọi thứ làm thay đổi số dư ngoài khoản chi. */
export const balanceMoves = (ledger: Ledger): DebtSettlement[] => [...ledger.settlements, ...ledger.adjustments];

/**
 * Đọc toàn bộ sổ của một nhà (mọi khoản chi + settlement) để tính số dư ròng. Không lưu bảng nợ:
 * số dư luôn tính lại từ dữ liệu gốc, nên sửa/xóa khoản chi không làm lệch.
 * `db` cho phép gọi trong transaction.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async load(houseId: string, db: Prisma.TransactionClient = this.prisma): Promise<Ledger> {
    const [expenses, settlements, adjustmentLines] = await Promise.all([
      db.expense.findMany({
        where: { houseId },
        select: { payerId: true, totalAmount: true, splits: { select: { userId: true, allocatedAmount: true } } },
      }),
      db.settlement.findMany({
        where: { houseId },
        select: { id: true, fromUserId: true, toUserId: true, amount: true, status: true, createdAt: true, proofUrl: true },
      }),
      db.balanceAdjustmentLine.findMany({
        where: { houseId },
        select: { fromUserId: true, toUserId: true, amount: true },
      }),
    ]);
    const adjustments = adjustmentLines.map((l) => ({ ...l, status: 'CONFIRMED' as const }));
    return { expenses, settlements, adjustments };
  }

  /** Số dư ròng (dương = được nhận, âm = cần trả). Chỉ settlement CONFIRMED được tính, cộng các dòng điều chỉnh. */
  async netBalances(houseId: string, db: Prisma.TransactionClient = this.prisma): Promise<Map<string, number>> {
    const ledger = await this.load(houseId, db);
    return computeNetBalances(ledger.expenses, balanceMoves(ledger));
  }
}

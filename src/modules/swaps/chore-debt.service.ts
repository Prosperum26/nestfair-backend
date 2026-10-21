import { Injectable } from '@nestjs/common';
import type { ChoreDebt, ChoreSwapRequest } from '../../generated/prisma/client.js';
import type { Db } from '../chores/schedule-context.js';

/** Sổ nợ ca (làm bù). Task 9 thêm cấn trừ, cửa sổ chọn bù và danh sách. */
@Injectable()
export class ChoreDebtService {
  /**
   * COVER + PAYBACK được chấp nhận: người nhờ nợ người làm hộ một ca (D7: nợ chỉ có hiệu lực khi ca gốc DONE,
   * nhưng dòng nợ được tạo ngay ở trạng thái OPEN).
   */
  async createOrOffsetDebt(tx: Db, swap: ChoreSwapRequest, creditorMemberId: string): Promise<ChoreDebt> {
    return tx.choreDebt.create({
      data: {
        houseId: swap.houseId,
        debtorMemberId: swap.requesterMemberId,
        creditorMemberId,
        swapRequestId: swap.id,
        coverAssignmentId: swap.fromAssignmentId!,
        weight: swap.fromWeightSnapshot,
      },
    });
  }
}

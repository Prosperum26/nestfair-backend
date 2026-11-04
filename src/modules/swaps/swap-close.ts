import type { ChoreSwapRequest } from '../../generated/prisma/client.js';
import type { SwapResolution, SwapStatus } from '../../generated/prisma/enums.js';
import type { Db } from '../chores/schedule-context.js';

/**
 * Rời PENDING: ghi trạng thái cuối và xóa SwapLock trong cùng transaction (spec 4.4).
 * Trả dòng đã cập nhật.
 */
export async function closeSwap(
  tx: Db,
  swap: ChoreSwapRequest,
  status: Exclude<SwapStatus, 'PENDING'>,
  resolution: SwapResolution,
  extra: Partial<ChoreSwapRequest> = {},
): Promise<ChoreSwapRequest> {
  const { id: _id, ...rest } = extra;
  const updated = await tx.choreSwapRequest.update({
    where: { id: swap.id },
    data: { ...rest, status, resolution, closedAt: extra.closedAt ?? new Date(), version: { increment: 1 } },
  });
  await tx.swapLock.deleteMany({ where: { swapRequestId: swap.id } });
  return updated;
}

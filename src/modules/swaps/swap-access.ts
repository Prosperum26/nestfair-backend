import { HttpStatus, NotFoundException } from '@nestjs/common';
import { coded } from '../../common/coded-exception.js';
import type { ChoreSwapRequest } from '../../generated/prisma/client.js';
import type { HouseRole } from '../../generated/prisma/enums.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = 'Không tìm thấy yêu cầu đổi ca.';

export interface SwapAccess {
  swap: ChoreSwapRequest;
  membership: { id: string; houseId: string; userId: string; role: HouseRole };
}

/**
 * Route `/swaps/:swapId` không có houseId trên URL: nhà suy ra từ chính yêu cầu.
 * - Chưa từng ở nhà đó → 404 (không lộ yêu cầu có tồn tại).
 * - Đã rời nhà → 403.
 */
export async function loadSwapForUser(prisma: PrismaService, userId: string, swapId: string): Promise<SwapAccess> {
  if (!UUID.test(swapId)) throw new NotFoundException(NOT_FOUND);
  const swap = await prisma.choreSwapRequest.findUnique({ where: { id: swapId } });
  if (!swap) throw new NotFoundException(NOT_FOUND);

  const active = await prisma.houseMember.findFirst({
    where: { houseId: swap.houseId, userId, leftAt: null },
    select: { id: true, houseId: true, userId: true, role: true },
  });
  if (active) return { swap, membership: active };

  const former = await prisma.houseMember.findFirst({ where: { houseId: swap.houseId, userId }, select: { id: true } });
  if (!former) throw new NotFoundException(NOT_FOUND);
  throw coded(HttpStatus.FORBIDDEN, 'LEFT_HOUSE', 'Bạn đã rời nhà này.');
}

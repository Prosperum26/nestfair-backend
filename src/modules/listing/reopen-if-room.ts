import type { Prisma } from '../../generated/prisma/client.js';
import { shouldReopenAfterFull } from './algorithms/status.js';

/**
 * Có người rời hoặc sức chứa tăng làm nhà hết đủ người thì tin đã đóng vì `FULL` mở lại (`OPEN`).
 * Gọi trong transaction đã khóa dòng nhà, sau khi đếm thành viên. Hàm KHÔNG phát event: nơi gọi phát
 * `listing:reopened` sau khi commit, với `{ listingId }`.
 *
 * @returns `{ listingId }` nếu vừa mở lại, `null` nếu không có gì đổi.
 */
export async function reopenListingIfRoom(
  tx: Prisma.TransactionClient,
  houseId: string,
  memberCount: number,
  maxMembers: number,
): Promise<{ listingId: string } | null> {
  const listing = await tx.roomListing.findUnique({
    where: { houseId },
    select: { id: true, status: true, closeReason: true },
  });
  if (!listing || !shouldReopenAfterFull({ ...listing, slotsOpen: maxMembers - memberCount })) return null;

  await tx.roomListing.update({
    where: { id: listing.id },
    data: { status: 'OPEN', closeReason: null, closedAt: null },
  });
  return { listingId: listing.id };
}

import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Nhà đủ người thì tin đang `OPEN` tự chuyển `CLOSED/FULL` (mục 4.4). Gọi trong transaction đã khóa dòng nhà
 * (`SELECT ... FOR UPDATE`) sau khi đếm thành viên. Hàm KHÔNG phát event: nơi gọi phát `listing:closed`
 * sau khi transaction commit, với `{ listingId, reason: 'FULL' }`.
 *
 * @returns `{ listingId }` nếu vừa đóng tin, `null` nếu còn chỗ hoặc nhà không có tin `OPEN`.
 */
export async function closeListingIfFull(
  tx: Prisma.TransactionClient,
  houseId: string,
  memberCount: number,
  maxMembers: number,
  now: Date = new Date(),
): Promise<{ listingId: string } | null> {
  if (memberCount < maxMembers) return null;

  const listing = await tx.roomListing.findFirst({
    where: { houseId, status: 'OPEN' },
    select: { id: true },
  });
  if (!listing) return null;

  await tx.roomListing.update({
    where: { id: listing.id },
    data: { status: 'CLOSED', closeReason: 'FULL', closedAt: now },
  });
  return { listingId: listing.id };
}

import type { PrismaClient } from '../src/generated/prisma/client.js';

/** Slug cố định của tin demo, khớp ảnh thiết kế 21 và mã QR in thử. */
export const DEMO_LISTING_SLUG = 'x7Kp2QmA';

/** Ảnh minh họa nằm ở `nestfair-frontend/public/seed/` (FE phục vụ, nên URL tương đối). */
const PHOTOS = [
  { category: 'BEDROOM', files: ['bedroom-1', 'bedroom-2', 'bedroom-3'] },
  { category: 'BATHROOM', files: ['bathroom-1', 'bathroom-2'] },
  { category: 'LIVING', files: ['living-1', 'living-2'] },
] as const;

/**
 * Tin demo của Nhà 12A theo Design.md mục 7 và ảnh 20/21. Chạy lại bao nhiêu lần cũng được: `upsert` theo
 * `houseId` (một nhà một tin) rồi tạo lại 7 ảnh, và luôn đưa tin về `OPEN`. Slug chỉ ghi khi tạo mới, vì slug bất biến.
 * Không đụng sổ chi: tiền điện nước của tin được tính từ chi tiêu thật của nhà lúc đọc, nên phụ thuộc ngày chạy.
 */
export async function seedListing(
  prisma: PrismaClient,
  { houseId, contactPhone, slug = DEMO_LISTING_SLUG }: { houseId: string; contactPhone: string; slug?: string },
): Promise<void> {
  const content = {
    status: 'OPEN',
    closeReason: null,
    closedAt: null,
    locationText: 'Hẻm 51 Linh Trung, Thủ Đức · 5 phút đi bộ tới UIT',
    genderWanted: 'ANY',
    rentPerMonth: 1_200_000,
    otherFees: [
      { name: 'Wifi', amount: 60_000 },
      { name: 'Gửi xe', amount: 100_000 },
    ],
    description:
      'Phòng 28m² tầng 2, có gác, cửa sổ thoáng. Bếp chung, máy giặt chung. Chủ trọ ở tầng 1, giờ giấc tự do, khóa vân tay.',
    roommateExpectations:
      'Sinh viên UIT hoặc làng ĐH, sạch sẽ, chịu làm việc nhà theo lịch xoay vòng trên NestFair, không hút thuốc trong phòng.',
    contactPhone,
    showChoreSchedule: true,
    publishedAt: new Date(),
  } as const;

  await prisma.$transaction(async (tx) => {
    const listing = await tx.roomListing.upsert({
      where: { houseId },
      update: content,
      create: { houseId, slug, ...content },
      select: { id: true },
    });
    await tx.listingPhoto.deleteMany({ where: { listingId: listing.id } });
    await tx.listingPhoto.createMany({
      data: PHOTOS.flatMap(({ category, files }) =>
        files.map((file, sortOrder) => ({ listingId: listing.id, category, url: `/seed/${file}.svg`, sortOrder })),
      ),
    });
  });
}

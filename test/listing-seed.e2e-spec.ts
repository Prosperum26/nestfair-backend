import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthRange } from '../src/modules/expenses/month.js';
import { generateSlug } from '../src/modules/listing/algorithms/slug.js';
import { previousMonthKeys } from '../src/modules/listing/algorithms/pricing.js';
import { DEMO_LISTING_SLUG, seedListing } from '../prisma/seed-listing.js';
import { createFixture } from './support/house-fixture.js';

/**
 * `seedListing` của prisma/seed.ts (Issue #11, B9). Test hàm xuất ra được, KHÔNG spawn cả `npm run seed` (R6).
 * Seed thật và e2e dùng chung một DB, nên test truyền slug riêng để không đụng tin demo `x7Kp2QmA` của seed thật
 * (cột `slug` UNIQUE); riêng hằng số slug mặc định được kiểm ở test đầu.
 */
describe('seedListing (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const DOMAIN = '@e2e-listing-seed.nestfair.test';
  const PHONE = '0901234567';

  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  /** Nhà 5 chỗ, 4 người, một khoản điện 400.000đ ở THÁNG TRƯỚC tính theo `now` (không đặt ngày cố định). */
  async function demoHouse() {
    const house = await fx.houseWith(['Trần Hùng Seed', 'Lê Thiện Seed', 'Phạm Mai Seed', 'Nguyễn Quân Seed']);
    await fx.prisma.house.update({ where: { id: house.houseId }, data: { maxMembers: 5 } });
    const [lastMonth] = previousMonthKeys(new Date());
    await fx.prisma.expense.create({
      data: {
        houseId: house.houseId,
        payerId: house.users[0].id,
        createdById: house.users[0].id,
        title: 'Tiền điện tháng trước',
        category: 'ELECTRICITY',
        totalAmount: 400_000,
        splitType: 'EQUAL',
        spentAt: new Date(monthRange(lastMonth).start.getTime() + 9 * 86_400_000),
        splits: { create: house.users.map((u) => ({ userId: u.id, allocatedAmount: 100_000 })) },
      },
    });
    return house;
  }

  it('slug demo mặc định cố định là x7Kp2QmA (như ảnh thiết kế 21)', () => {
    expect(DEMO_LISTING_SLUG).toBe('x7Kp2QmA');
  });

  it('tạo tin OPEN kèm 7 ảnh (3 phòng ngủ, 2 phòng vệ sinh, 2 gian sinh hoạt); trang công khai ra đúng số', async () => {
    const { houseId } = await demoHouse();
    const slug = generateSlug();

    await seedListing(fx.prisma, { houseId, contactPhone: PHONE, slug });

    const listing = await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId }, include: { photos: true } });
    expect(listing).toMatchObject({
      slug,
      status: 'OPEN',
      closeReason: null,
      closedAt: null,
      genderWanted: 'ANY',
      rentPerMonth: 1_200_000,
      contactPhone: PHONE,
      locationText: 'Hẻm 51 Linh Trung, Thủ Đức · 5 phút đi bộ tới UIT',
      showChoreSchedule: true,
    });
    expect(listing.publishedAt).toBeInstanceOf(Date);
    expect(listing.otherFees).toEqual([
      { name: 'Wifi', amount: 60_000 },
      { name: 'Gửi xe', amount: 100_000 },
    ]);
    const count = (category: string) => listing.photos.filter((p) => p.category === category).length;
    expect([count('BEDROOM'), count('BATHROOM'), count('LIVING')]).toEqual([3, 2, 2]);
    expect(listing.photos.every((p) => /^\/seed\/[a-z]+-\d\.svg$/.test(p.url))).toBe(true);

    const pub = await fx.http().get(`/api/v1/public/listings/${slug}`).expect(200);
    expect(pub.body.status).toBe('OPEN');
    expect(pub.body.summary).toMatchObject({ memberCount: 4, maxMembers: 5, slotsOpen: 1 });
    // 1.200.000 + Wifi 60.000 + Gửi xe 100.000 + điện tháng trước 400.000 / 5 người = 80.000
    expect(pub.body.estimatedPerPerson).toBe(1_440_000);
    expect(pub.body.contact.phone).toBe(PHONE);
    expect(pub.body.photos.BEDROOM).toHaveLength(3);
  });

  it('chạy hai lần liên tiếp: vẫn đúng một tin, 7 ảnh, cùng id và slug, trả về OPEN', async () => {
    const { houseId } = await demoHouse();
    const slug = generateSlug();

    await seedListing(fx.prisma, { houseId, contactPhone: PHONE, slug });
    const first = await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId } });
    await seedListing(fx.prisma, { houseId, contactPhone: PHONE, slug });

    expect(await fx.prisma.roomListing.count({ where: { houseId } })).toBe(1);
    const second = await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId }, include: { photos: true } });
    expect(second).toMatchObject({ id: first.id, slug, status: 'OPEN' });
    expect(second.photos).toHaveLength(7);
    expect(await fx.prisma.listingPhoto.count({ where: { listingId: first.id } })).toBe(7);
  });

  it('chạy lại sau khi tin bị đóng: đưa tin demo về OPEN, không còn closeReason', async () => {
    const { houseId } = await demoHouse();
    const slug = generateSlug();
    await seedListing(fx.prisma, { houseId, contactPhone: PHONE, slug });
    await fx.prisma.roomListing.update({
      where: { houseId },
      data: { status: 'CLOSED', closeReason: 'MANUAL', closedAt: new Date() },
    });

    await seedListing(fx.prisma, { houseId, contactPhone: PHONE, slug });

    expect(await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId } })).toMatchObject({
      status: 'OPEN',
      closeReason: null,
      closedAt: null,
    });
  });

  it('không đụng sổ chi: số khoản chi của nhà không đổi (L11)', async () => {
    const { houseId } = await demoHouse();
    const before = await fx.prisma.expense.count({ where: { houseId } });

    await seedListing(fx.prisma, { houseId, contactPhone: PHONE, slug: generateSlug() });

    expect(await fx.prisma.expense.count({ where: { houseId } })).toBe(before);
  });
});

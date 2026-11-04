import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture } from './support/house-fixture.js';

/** Ràng buộc DB của tin đăng (Issue #11, B1). Gọi thẳng Prisma để chứng minh CHECK/UNIQUE nằm ở DB. */
describe('Listing schema (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let slugSeq = 0;
  const DOMAIN = '@listing-schema.test';

  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  /** Mỗi case một nhà riêng để UNIQUE(houseId) không làm nhiễu các case khác. */
  async function newHouse() {
    const { houseId } = await fx.houseWith(['Trưởng phòng']);
    return houseId;
  }

  const nextSlug = () => `T${Date.now().toString(36)}${slugSeq++}`.padEnd(8, '0').slice(-8);

  function data(houseId: string, over: Record<string, unknown> = {}) {
    return {
      houseId,
      slug: nextSlug(),
      locationText: 'Hẻm 51 Linh Trung, Thủ Đức',
      rentPerMonth: 1_200_000,
      contactPhone: '0901234567',
      ...over,
    };
  }

  it('tạo được tin hợp lệ với giá trị mặc định đúng', async () => {
    const houseId = await newHouse();
    const listing = await fx.prisma.roomListing.create({ data: data(houseId) });
    expect(listing.status).toBe('DRAFT');
    expect(listing.closeReason).toBeNull();
    expect(listing.genderWanted).toBe('ANY');
    expect(listing.otherFees).toEqual([]);
    expect(listing.showChoreSchedule).toBe(true);
    expect(listing.description).toBe('');
  });

  it('tin CLOSED có closeReason là hợp lệ', async () => {
    const houseId = await newHouse();
    const listing = await fx.prisma.roomListing.create({
      data: data(houseId, { status: 'CLOSED', closeReason: 'FULL', closedAt: new Date() }),
    });
    expect(listing.status).toBe('CLOSED');
  });

  it('từ chối slug trùng', async () => {
    const [h1, h2] = [await newHouse(), await newHouse()];
    const slug = nextSlug();
    await fx.prisma.roomListing.create({ data: data(h1, { slug }) });
    await expect(fx.prisma.roomListing.create({ data: data(h2, { slug }) })).rejects.toThrow();
  });

  it.each(['abc', 'abcd-efg', 'abcdefghi', 'abc def1'])('từ chối slug "%s"', async (slug) => {
    const houseId = await newHouse();
    await expect(fx.prisma.roomListing.create({ data: data(houseId, { slug }) })).rejects.toThrow();
  });

  it('từ chối hai tin cùng houseId (L2)', async () => {
    const houseId = await newHouse();
    await fx.prisma.roomListing.create({ data: data(houseId) });
    await expect(fx.prisma.roomListing.create({ data: data(houseId) })).rejects.toThrow();
  });

  it.each([0, -1, 50_000_001])('từ chối rentPerMonth = %i', async (rentPerMonth) => {
    const houseId = await newHouse();
    await expect(
      fx.prisma.roomListing.create({ data: data(houseId, { rentPerMonth }) }),
    ).rejects.toThrow();
  });

  it('chấp nhận rentPerMonth ở hai biên 1 và 50.000.000', async () => {
    for (const rentPerMonth of [1, 50_000_000]) {
      const houseId = await newHouse();
      await fx.prisma.roomListing.create({ data: data(houseId, { rentPerMonth }) });
    }
  });

  it.each(['123', '09012345678', '1901234567', 'abcdefghij'])(
    'từ chối contactPhone "%s"',
    async (contactPhone) => {
      const houseId = await newHouse();
      await expect(
        fx.prisma.roomListing.create({ data: data(houseId, { contactPhone }) }),
      ).rejects.toThrow();
    },
  );

  it('từ chối OPEN kèm closeReason', async () => {
    const houseId = await newHouse();
    await expect(
      fx.prisma.roomListing.create({ data: data(houseId, { status: 'OPEN', closeReason: 'FULL' }) }),
    ).rejects.toThrow();
  });

  it('từ chối CLOSED không có closeReason', async () => {
    const houseId = await newHouse();
    await expect(
      fx.prisma.roomListing.create({ data: data(houseId, { status: 'CLOSED' }) }),
    ).rejects.toThrow();
  });

  it('từ chối otherFees là object thay vì mảng', async () => {
    const houseId = await newHouse();
    await expect(
      fx.prisma.roomListing.create({ data: data(houseId, { otherFees: { name: 'Wifi', amount: 1 } }) }),
    ).rejects.toThrow();
  });

  it('từ chối ảnh có sortOrder âm', async () => {
    const houseId = await newHouse();
    const listing = await fx.prisma.roomListing.create({ data: data(houseId) });
    await expect(
      fx.prisma.listingPhoto.create({
        data: { listingId: listing.id, category: 'BEDROOM', url: 'https://x/a.jpg', sortOrder: -1 },
      }),
    ).rejects.toThrow();
  });

  it('xóa House kéo theo xóa tin và ảnh (cascade)', async () => {
    const houseId = await newHouse();
    const listing = await fx.prisma.roomListing.create({ data: data(houseId) });
    await fx.prisma.listingPhoto.create({
      data: { listingId: listing.id, category: 'LIVING', url: 'https://x/b.jpg', sortOrder: 0 },
    });

    await fx.prisma.house.delete({ where: { id: houseId } });

    expect(await fx.prisma.roomListing.count({ where: { id: listing.id } })).toBe(0);
    expect(await fx.prisma.listingPhoto.count({ where: { listingId: listing.id } })).toBe(0);
  });
});

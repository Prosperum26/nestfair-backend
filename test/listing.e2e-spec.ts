import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { previousMonthKeys } from '../src/modules/listing/algorithms/pricing.js';
import { isValidSlug } from '../src/modules/listing/algorithms/slug.js';
import { monthRange } from '../src/modules/expenses/month.js';
import { createFixture } from './support/house-fixture.js';

/** API trưởng phòng đọc và lưu tin đăng (Issue #11, B4). */
describe('Listing admin API (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let publicWebUrl: string;
  const DOMAIN = '@e2e-listing.nestfair.test';

  const body = (over: Record<string, unknown> = {}) => ({
    locationText: 'Hẻm 51 Linh Trung, Thủ Đức',
    genderWanted: 'ANY',
    rentPerMonth: 1_200_000,
    otherFees: [
      { name: 'Wifi', amount: 60_000 },
      { name: 'Gửi xe', amount: 100_000 },
    ],
    description: 'Phòng thoáng, gần UIT.',
    roommateExpectations: 'Sạch sẽ, ngủ sớm.',
    contactPhone: '0901234567',
    showChoreSchedule: true,
    ...over,
  });

  const url = (houseId: string) => `/api/v1/houses/${houseId}/listing`;

  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
    publicWebUrl = fx.app.get(ConfigService).get<string>('PUBLIC_WEB_URL')!.replace(/\/+$/, '');
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  /** Nhà 3 người (maxMembers 3): admin, member, và một người ngoài nhà. */
  async function setup() {
    const house = await fx.houseWith(['Trưởng phòng', 'Thành viên']);
    const outsider = await fx.user('Người ngoài');
    return { ...house, admin: house.users[0], member: house.users[1], outsider };
  }

  describe('GET /houses/:houseId/listing', () => {
    it('chưa có tin: listing null và summary, gợi ý đúng', async () => {
      const { houseId, admin } = await setup();
      await fx.prisma.house.update({ where: { id: houseId }, data: { address: 'Hẻm 51, Linh Trung' } });

      const res = await fx.as(admin.token).get(url(houseId)).expect(200);

      expect(res.body.listing).toBeNull();
      expect(res.body.publicUrl).toBeNull();
      expect(res.body.estimatedPerPerson).toBeNull();
      expect(res.body.missing).toEqual([]);
      expect(res.body.summary).toEqual({
        memberCount: 2,
        maxMembers: 2,
        slotsOpen: 0,
        utilities: { avgMonthlyTotal: null, perPerson: null, monthsUsed: 0 },
      });
      expect(res.body.suggestions).toEqual({
        locationText: 'Hẻm 51, Linh Trung',
        contactPhone: '0901234567',
      });
    });

    it('slotsOpen tính trực tiếp từ số thành viên đang ở, không đếm người đã rời', async () => {
      const { houseId, admin, member, memberId } = await setup();
      await fx.prisma.house.update({ where: { id: houseId }, data: { maxMembers: 5 } });
      await fx.prisma.houseMember.update({
        where: { id: memberId(member) },
        data: { leftAt: new Date() },
      });

      const res = await fx.as(admin.token).get(url(houseId)).expect(200);

      expect(res.body.summary).toMatchObject({ memberCount: 1, maxMembers: 5, slotsOpen: 4 });
    });

    it('thành viên thường đọc được', async () => {
      const { houseId, member } = await setup();
      await fx.as(member.token).get(url(houseId)).expect(200);
    });

    it('người ngoài nhà bị 403; houseId không phải UUID bị 404; chưa đăng nhập bị 401', async () => {
      const { houseId, outsider } = await setup();
      await fx.as(outsider.token).get(url(houseId)).expect(403);
      await fx.as(outsider.token).get('/api/v1/houses/khong-phai-uuid/listing').expect(404);
      await fx.http().get(url(houseId)).expect(401);
    });

    it('trưởng phòng nhà A không đọc được tin nhà B', async () => {
      const a = await setup();
      const b = await setup();
      await fx.as(b.admin.token).put(url(b.houseId), body()).expect(200);

      await fx.as(a.admin.token).get(url(b.houseId)).expect(403);
    });

    it('thiếu ảnh: missing đủ ba nhóm', async () => {
      const { houseId, admin } = await setup();
      await fx.as(admin.token).put(url(houseId), body()).expect(200);

      const res = await fx.as(admin.token).get(url(houseId)).expect(200);

      expect(res.body.listing.photos).toEqual([]);
      expect(res.body.missing).toEqual(['PHOTO_BEDROOM', 'PHOTO_BATHROOM', 'PHOTO_LIVING']);
    });

    it('có ảnh một nhóm thì nhóm đó không còn trong missing; ảnh sắp theo nhóm rồi sortOrder', async () => {
      const { houseId, admin } = await setup();
      const put = await fx.as(admin.token).put(url(houseId), body()).expect(200);
      const listingId = put.body.listing.id as string;
      await fx.prisma.listingPhoto.createMany({
        data: [
          { listingId, category: 'BEDROOM', url: 'https://x/b2.jpg', sortOrder: 1 },
          { listingId, category: 'BEDROOM', url: 'https://x/b1.jpg', sortOrder: 0 },
          { listingId, category: 'BATHROOM', url: 'https://x/w.jpg', sortOrder: 0 },
        ],
      });

      const res = await fx.as(admin.token).get(url(houseId)).expect(200);

      expect(res.body.missing).toEqual(['PHOTO_LIVING']);
      expect(res.body.listing.photos.map((p: { url: string }) => p.url)).toEqual([
        'https://x/b1.jpg',
        'https://x/b2.jpg',
        'https://x/w.jpg',
      ]);
      expect(res.body.listing.photos[0]).toEqual(
        expect.objectContaining({ id: expect.any(String), category: 'BEDROOM', sortOrder: 0 }),
      );
    });
  });

  describe('PUT /houses/:houseId/listing', () => {
    it('lần đầu: tạo DRAFT với slug hợp lệ và publicUrl đúng', async () => {
      const { houseId, admin } = await setup();

      const res = await fx.as(admin.token).put(url(houseId), body()).expect(200);

      const { listing } = res.body;
      expect(listing.status).toBe('DRAFT');
      expect(listing.closeReason).toBeNull();
      expect(isValidSlug(listing.slug)).toBe(true);
      expect(res.body.publicUrl).toBe(`${publicWebUrl}/r/${listing.slug}`);
      expect(listing).toMatchObject({
        locationText: 'Hẻm 51 Linh Trung, Thủ Đức',
        genderWanted: 'ANY',
        rentPerMonth: 1_200_000,
        otherFees: [
          { name: 'Wifi', amount: 60_000 },
          { name: 'Gửi xe', amount: 100_000 },
        ],
        contactPhone: '0901234567',
        showChoreSchedule: true,
        publishedAt: null,
        closedAt: null,
      });
      expect(listing).not.toHaveProperty('houseId');
      // chưa có điện nước: 1.200.000 + 0 + 160.000
      expect(res.body.estimatedPerPerson).toBe(1_360_000);
      expect(res.body.missing).toEqual(['PHOTO_BEDROOM', 'PHOTO_BATHROOM', 'PHOTO_LIVING']);
    });

    it('PUT lần hai giữ nguyên slug và id, cập nhật nội dung', async () => {
      const { houseId, admin } = await setup();
      const first = await fx.as(admin.token).put(url(houseId), body()).expect(200);

      const second = await fx
        .as(admin.token)
        .put(url(houseId), body({ rentPerMonth: 1_500_000, locationText: 'Chỗ mới', otherFees: [] }))
        .expect(200);
      const third = await fx.as(admin.token).put(url(houseId), body({ description: '' })).expect(200);

      expect(second.body.listing.slug).toBe(first.body.listing.slug);
      expect(second.body.listing.id).toBe(first.body.listing.id);
      expect(second.body.listing).toMatchObject({
        rentPerMonth: 1_500_000,
        locationText: 'Chỗ mới',
        otherFees: [],
      });
      expect(second.body.estimatedPerPerson).toBe(1_500_000);
      expect(third.body.listing.slug).toBe(first.body.listing.slug);
      expect(third.body.listing.description).toBe('');
      expect(await fx.prisma.roomListing.count({ where: { houseId } })).toBe(1);
    });

    it('không đổi status, publishedAt hay closeReason của tin đang có', async () => {
      const { houseId, admin } = await setup();
      const first = await fx.as(admin.token).put(url(houseId), body()).expect(200);
      const publishedAt = new Date('2026-10-04T03:00:00.000Z');
      await fx.prisma.roomListing.update({
        where: { id: first.body.listing.id },
        data: { status: 'OPEN', publishedAt },
      });

      const res = await fx.as(admin.token).put(url(houseId), body({ rentPerMonth: 1_300_000 })).expect(200);

      expect(res.body.listing.status).toBe('OPEN');
      expect(res.body.listing.publishedAt).toBe(publishedAt.toISOString());
      expect(res.body.listing.rentPerMonth).toBe(1_300_000);
    });

    it('trường tùy chọn bỏ trống thì lấy mặc định', async () => {
      const { houseId, admin } = await setup();
      const payload: Record<string, unknown> = body();
      delete payload.description;
      delete payload.roommateExpectations;
      delete payload.showChoreSchedule;
      delete payload.otherFees;

      const res = await fx.as(admin.token).put(url(houseId), payload).expect(200);

      expect(res.body.listing).toMatchObject({
        description: '',
        roommateExpectations: '',
        showChoreSchedule: true,
        otherFees: [],
      });
    });

    it('chuẩn hóa dữ liệu nhập: cắt khoảng trắng, bỏ khoảng trắng trong SĐT', async () => {
      const { houseId, admin } = await setup();

      const res = await fx
        .as(admin.token)
        .put(
          url(houseId),
          body({
            locationText: '  Hẻm 51  ',
            contactPhone: '090 123 4567',
            otherFees: [{ name: '  Wifi ', amount: 0 }],
          }),
        )
        .expect(200);

      expect(res.body.listing).toMatchObject({
        locationText: 'Hẻm 51',
        contactPhone: '0901234567',
        otherFees: [{ name: 'Wifi', amount: 0 }],
      });
    });

    it('thành viên thường bị 403; không có tin nào được tạo', async () => {
      const { houseId, member } = await setup();
      await fx.as(member.token).put(url(houseId), body()).expect(403);
      expect(await fx.prisma.roomListing.count({ where: { houseId } })).toBe(0);
    });

    it('trưởng phòng nhà A không ghi được vào nhà B; người ngoài bị 403', async () => {
      const a = await setup();
      const b = await setup();
      await fx.as(a.admin.token).put(url(b.houseId), body()).expect(403);
      await fx.as(a.outsider.token).put(url(b.houseId), body()).expect(403);
      expect(await fx.prisma.roomListing.count({ where: { houseId: b.houseId } })).toBe(0);
    });

    it('houseId trong body bị từ chối (không tin houseId của client)', async () => {
      const a = await setup();
      const b = await setup();
      await fx.as(a.admin.token).put(url(a.houseId), body({ houseId: b.houseId })).expect(400);
    });

    it.each([
      ['có thêm field status', { status: 'OPEN' }],
      ['có thêm field slug', { slug: 'abcdefgh' }],
      ['SĐT quá ngắn', { contactPhone: '123' }],
      ['SĐT không bắt đầu bằng 0', { contactPhone: '1901234567' }],
      ['otherFees 9 phần tử', { otherFees: Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, amount: 1 })) }],
      ['otherFees tên rỗng', { otherFees: [{ name: '   ', amount: 1 }] }],
      ['otherFees tên quá 40 ký tự', { otherFees: [{ name: 'x'.repeat(41), amount: 1 }] }],
      ['otherFees số tiền âm', { otherFees: [{ name: 'Wifi', amount: -1 }] }],
      ['otherFees số tiền quá 10.000.000', { otherFees: [{ name: 'Wifi', amount: 10_000_001 }] }],
      ['otherFees số tiền lẻ', { otherFees: [{ name: 'Wifi', amount: 1.5 }] }],
      ['otherFees là object', { otherFees: { name: 'Wifi', amount: 1 } }],
      ['locationText toàn khoảng trắng', { locationText: '     ' }],
      ['locationText quá ngắn', { locationText: 'ab' }],
      ['locationText quá 120 ký tự', { locationText: 'x'.repeat(121) }],
      ['rentPerMonth bằng 0', { rentPerMonth: 0 }],
      ['rentPerMonth quá 50.000.000', { rentPerMonth: 50_000_001 }],
      ['rentPerMonth là số lẻ', { rentPerMonth: 1_200_000.5 }],
      ['genderWanted ngoài enum', { genderWanted: 'OTHER' }],
      ['description quá 1000 ký tự', { description: 'x'.repeat(1001) }],
      ['roommateExpectations quá 500 ký tự', { roommateExpectations: 'x'.repeat(501) }],
      ['showChoreSchedule không phải boolean', { showChoreSchedule: 'yes' }],
      ['mapUrl không phải Google Maps', { mapUrl: 'https://evil.com/maps' }],
      ['mapUrl giả host google.com.evil.com', { mapUrl: 'https://google.com.evil.com/maps' }],
      ['mapUrl dùng http', { mapUrl: 'http://www.google.com/maps/place/UIT' }],
      ['mapUrl là javascript:', { mapUrl: 'javascript:alert(1)' }],
      ['mapUrl là trang Google Search', { mapUrl: 'https://www.google.com/search?q=uit' }],
      ['mapUrl quá 500 ký tự', { mapUrl: 'https://www.google.com/maps?q=' + 'a'.repeat(500) }],
      ['mapUrl là số', { mapUrl: 123 }],
    ])('400 khi %s', async (_label, over) => {
      const { houseId, admin } = await setup();
      await fx.as(admin.token).put(url(houseId), body(over)).expect(400);
      expect(await fx.prisma.roomListing.count({ where: { houseId } })).toBe(0);
    });

    it('mapUrl: lưu link Google Maps (cắt khoảng trắng), chuỗi rỗng hoặc null thì xóa, bỏ qua thì null', async () => {
      const { houseId, admin } = await setup();
      const link = 'https://www.google.com/maps/search/?api=1&query=10.87,106.803';
      const saved = await fx.as(admin.token).put(url(houseId), body({ mapUrl: `  ${link}  ` })).expect(200);
      expect(saved.body.listing.mapUrl).toBe(link);
      expect((await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId } })).mapUrl).toBe(link);

      const cleared = await fx.as(admin.token).put(url(houseId), body({ mapUrl: '' })).expect(200);
      expect(cleared.body.listing.mapUrl).toBeNull();

      await fx.as(admin.token).put(url(houseId), body({ mapUrl: 'https://maps.app.goo.gl/AbCdEf123' })).expect(200);
      const nulled = await fx.as(admin.token).put(url(houseId), body({ mapUrl: null })).expect(200);
      expect(nulled.body.listing.mapUrl).toBeNull();

      const omitted = await fx.as(admin.token).put(url(houseId), body()).expect(200);
      expect(omitted.body.listing.mapUrl).toBeNull();
    });

    it('thiếu field bắt buộc thì 400', async () => {
      const { houseId, admin } = await setup();
      for (const field of ['locationText', 'genderWanted', 'rentPerMonth', 'contactPhone']) {
        const payload: Record<string, unknown> = body();
        delete payload[field];
        await fx.as(admin.token).put(url(houseId), payload).expect(400);
      }
    });
  });

  describe('điện nước (L3)', () => {
    /** Ghi khoản chi bằng Prisma, `monthKey` là khóa tháng giờ VN, ngày 10 giữa tháng để tránh biên. */
    async function expense(
      houseId: string,
      userId: string,
      category: 'ELECTRICITY' | 'WATER' | 'FOOD',
      monthKey: string,
      totalAmount: number,
    ) {
      const spentAt = new Date(monthRange(monthKey).start.getTime() + 9 * 86_400_000);
      await fx.prisma.expense.create({
        data: {
          houseId,
          payerId: userId,
          createdById: userId,
          title: `${category} ${monthKey}`,
          category,
          totalAmount,
          splitType: 'EQUAL',
          spentAt,
          splits: { create: [{ userId, allocatedAmount: totalAmount }] },
        },
      });
    }

    it('trung bình ba tháng đã khép, chia cho maxMembers; bỏ tháng hiện tại và danh mục khác', async () => {
      const { houseId, admin } = await setup();
      await fx.prisma.house.update({ where: { id: houseId }, data: { maxMembers: 5 } });
      const [m1, m2, m3] = previousMonthKeys(new Date());
      await expense(houseId, admin.id, 'ELECTRICITY', m1, 800_000);
      await expense(houseId, admin.id, 'WATER', m1, 400_000); // tháng m1 = 1.200.000
      await expense(houseId, admin.id, 'ELECTRICITY', m2, 1_000_000);
      await expense(houseId, admin.id, 'WATER', m2, 350_000); // tháng m2 = 1.350.000
      await expense(houseId, admin.id, 'ELECTRICITY', m3, 1_275_000); // tháng m3 = 1.275.000
      await expense(houseId, admin.id, 'FOOD', m1, 5_000_000); // không phải điện nước
      await fx.prisma.expense.create({
        data: {
          houseId,
          payerId: admin.id,
          createdById: admin.id,
          title: 'Điện tháng này',
          category: 'ELECTRICITY',
          totalAmount: 9_999_999,
          splitType: 'EQUAL',
          spentAt: new Date(),
          splits: { create: [{ userId: admin.id, allocatedAmount: 9_999_999 }] },
        },
      });

      const res = await fx.as(admin.token).get(url(houseId)).expect(200);

      expect(res.body.summary.utilities).toEqual({
        avgMonthlyTotal: 1_275_000,
        perPerson: 255_000,
        monthsUsed: 3,
      });
    });

    it('estimatedPerPerson = tiền thuê + điện nước mỗi người + phí khác', async () => {
      const { houseId, admin } = await setup();
      await fx.prisma.house.update({ where: { id: houseId }, data: { maxMembers: 5 } });
      for (const key of previousMonthKeys(new Date())) {
        await expense(houseId, admin.id, 'ELECTRICITY', key, 1_275_000);
      }
      await fx.as(admin.token).put(url(houseId), body()).expect(200);

      const res = await fx.as(admin.token).get(url(houseId)).expect(200);

      // 1.200.000 + 255.000 + (60.000 + 100.000)
      expect(res.body.estimatedPerPerson).toBe(1_615_000);
    });

    it('không có khoản nào → null và monthsUsed = 0; chỉ có tháng hiện tại vẫn là null', async () => {
      const { houseId, admin } = await setup();
      await fx.prisma.expense.create({
        data: {
          houseId,
          payerId: admin.id,
          createdById: admin.id,
          title: 'Nước tháng này',
          category: 'WATER',
          totalAmount: 500_000,
          splitType: 'EQUAL',
          spentAt: new Date(),
          splits: { create: [{ userId: admin.id, allocatedAmount: 500_000 }] },
        },
      });

      const res = await fx.as(admin.token).get(url(houseId)).expect(200);

      expect(res.body.summary.utilities).toEqual({ avgMonthlyTotal: null, perPerson: null, monthsUsed: 0 });
    });

    it('chỉ tính chi tiêu của chính nhà này', async () => {
      const a = await setup();
      const b = await setup();
      const [m1] = previousMonthKeys(new Date());
      await expense(b.houseId, b.admin.id, 'ELECTRICITY', m1, 900_000);

      const res = await fx.as(a.admin.token).get(url(a.houseId)).expect(200);

      expect(res.body.summary.utilities.monthsUsed).toBe(0);
    });
  });
});

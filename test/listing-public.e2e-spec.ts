import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { monthRange } from '../src/modules/expenses/month.js';
import { previousMonthKeys } from '../src/modules/listing/algorithms/pricing.js';
import { currentWeekStart, weekKeyFromStart } from '../src/modules/chores/week.js';
import { createFixture } from './support/house-fixture.js';

/** Endpoint công khai GET /public/listings/:slug (Issue #11, B7). Không gửi Authorization. */
describe('Public listing API (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const DOMAIN = '@e2e-listing-public.nestfair.test';
  const LISTING_PHONE = '0912345678';
  const PROFILE_PHONE = '0987000111';

  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  const publicGet = (slug: string) => fx.http().get(`/api/v1/public/listings/${slug}`);
  const adminUrl = (houseId: string) => `/api/v1/houses/${houseId}/listing`;

  /**
   * Nhà 2 thành viên, tối đa 4, có tin kèm đủ ảnh. Mọi dữ liệu cá nhân là chuỗi "mồi" riêng biệt
   * để chứng minh chúng không lọt vào response công khai.
   */
  async function setup({ status = 'OPEN' as 'DRAFT' | 'OPEN' | 'CLOSED', showChoreSchedule = true } = {}) {
    const house = await fx.houseWith(['Trần Hùng Bait', 'Lê Thiện Bait']);
    const [admin, member] = house.users;
    await fx.prisma.house.update({ where: { id: house.houseId }, data: { maxMembers: 4, name: 'Nhà MoiTenNha 12A' } });
    for (const [i, u] of house.users.entries()) {
      await fx.prisma.user.update({
        where: { id: u.id },
        data: {
          phone: PROFILE_PHONE,
          bankBin: `97700${i}`,
          bankAccount: `88880001112${i}`,
          avatarUrl: `https://bait.example/avatar-${i}.png`,
        },
      });
    }
    await fx
      .as(admin.token)
      .put(adminUrl(house.houseId), {
        locationText: 'Hẻm 51 Linh Trung, Thủ Đức',
        mapUrl: 'https://www.google.com/maps/search/?api=1&query=10.87,106.803',
        genderWanted: 'FEMALE',
        rentPerMonth: 1_200_000,
        otherFees: [{ name: 'Wifi', amount: 60_000 }],
        description: 'Phòng thoáng, gần UIT.',
        roommateExpectations: 'Sạch sẽ.',
        contactPhone: LISTING_PHONE,
        showChoreSchedule,
      })
      .expect(200);
    const listing = await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId: house.houseId } });
    await fx.prisma.listingPhoto.createMany({
      data: [
        { listingId: listing.id, category: 'BEDROOM', sortOrder: 1, url: 'https://res.cloudinary.com/demo/image/upload/v1/b2.jpg' },
        { listingId: listing.id, category: 'BEDROOM', sortOrder: 0, url: 'https://res.cloudinary.com/demo/image/upload/v1/b1.jpg' },
        { listingId: listing.id, category: 'BATHROOM', sortOrder: 0, url: 'https://res.cloudinary.com/demo/image/upload/v1/w.jpg' },
        { listingId: listing.id, category: 'LIVING', sortOrder: 0, url: 'https://res.cloudinary.com/demo/image/upload/v1/l.jpg' },
      ],
    });
    if (status !== 'DRAFT') {
      await fx.prisma.roomListing.update({
        where: { id: listing.id },
        data:
          status === 'CLOSED'
            ? { status, closeReason: 'MANUAL', closedAt: new Date(), publishedAt: new Date() }
            : { status, publishedAt: new Date() },
      });
    }
    return { ...house, admin, member, listing: await fx.prisma.roomListing.findUniqueOrThrow({ where: { id: listing.id } }) };
  }

  /** Mọi chuỗi định danh/riêng tư của nhà này: không được xuất hiện trong body công khai. */
  async function secrets(houseId: string) {
    const house = await fx.prisma.house.findUniqueOrThrow({ where: { id: houseId } });
    const members = await fx.prisma.houseMember.findMany({ where: { houseId }, include: { user: true } });
    const listing = await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId } });
    return [
      houseId,
      house.name,
      house.inviteCode,
      listing.id,
      PROFILE_PHONE,
      ...members.flatMap((m) => [
        m.id,
        m.userId,
        m.user.fullName,
        m.user.email,
        m.user.bankBin!,
        m.user.bankAccount!,
        m.user.avatarUrl!,
      ]),
    ];
  }

  async function addRoster(houseId: string, memberIds: string[]) {
    const chore = await fx.prisma.chore.create({
      data: { houseId, title: 'Rửa chén', weight: 2, recurrenceDays: [1, 2, 3, 4, 5, 6, 7] },
    });
    const weekStart = currentWeekStart();
    const day = (offset: number) => new Date(Date.parse(`${weekStart}T00:00:00.000Z`) + offset * 86_400_000);
    const row = (assigneeId: string | null, offset: number, extra: object = {}) => ({
      houseId,
      choreId: chore.id,
      assigneeId,
      weekKey: weekKeyFromStart(weekStart),
      weekStart: day(0),
      occurrenceDate: day(offset),
      dueAt: new Date(day(offset).getTime() + 14 * 3_600_000),
      titleSnapshot: 'Rửa chén',
      weightSnapshot: 2,
      source: 'ROTATION' as const,
      ...extra,
    });
    await fx.prisma.choreAssignment.createMany({
      data: [
        row(memberIds[0], 0),
        row(memberIds[1], 1),
        row(memberIds[0], 6),
        row(memberIds[1], 2, { status: 'CANCELLED' }),
        row(memberIds[1], 3, { source: 'WHEEL' }),
        row(null, 4, { status: 'UNASSIGNED' }),
      ],
    });
  }

  describe('tin OPEN', () => {
    it('200 không cần đăng nhập; payload mục 4.3; Cache-Control: no-store', async () => {
      const { listing } = await setup();

      const res = await publicGet(listing.slug).expect(200);

      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        slug: listing.slug,
        status: 'OPEN',
        closeReason: null,
        locationText: 'Hẻm 51 Linh Trung, Thủ Đức',
        mapUrl: 'https://www.google.com/maps/search/?api=1&query=10.87,106.803',
        genderWanted: 'FEMALE',
        rentPerMonth: 1_200_000,
        otherFees: [{ name: 'Wifi', amount: 60_000 }],
        description: 'Phòng thoáng, gần UIT.',
        roommateExpectations: 'Sạch sẽ.',
        contact: { phone: LISTING_PHONE },
        summary: { memberCount: 2, maxMembers: 4, slotsOpen: 2 },
        // Chưa có điện nước: 1.200.000 + 60.000.
        estimatedPerPerson: 1_260_000,
      });
      expect(res.body.publishedAt).toEqual(expect.any(String));
      const photos = res.body.photos;
      expect(photos.BEDROOM.map((p: { url: string }) => p.url.split('/').pop())).toEqual(['b1.jpg', 'b2.jpg']);
      expect(photos.BATHROOM).toHaveLength(1);
      expect(photos.LIVING).toHaveLength(1);
      expect(Object.keys(photos.BEDROOM[0]).sort()).toEqual(['id', 'url']);
      for (const key of ['id', 'houseId', 'contactPhone', 'showChoreSchedule', 'createdAt', 'updatedAt']) {
        expect(res.body).not.toHaveProperty(key);
      }
    });

    it('chuỗi "mồi": không có họ tên, email, STK, mã BIN, avatar, SĐT hồ sơ, id, mã mời, tên nhà trong toàn bộ body', async () => {
      const { listing, houseId } = await setup();
      await addRoster(houseId, (await fx.prisma.houseMember.findMany({ where: { houseId } })).map((m) => m.id));

      const res = await publicGet(listing.slug).expect(200);
      const json = JSON.stringify(res.body);

      expect(res.body.roster).not.toBeNull(); // có lịch để chắc chắn đã kiểm cả phần roster
      for (const secret of await secrets(houseId)) expect(json, `lộ "${secret}"`).not.toContain(secret);
      // Số liên hệ của tin thì được phép có, đúng một chỗ.
      expect(json.split(LISTING_PHONE)).toHaveLength(2);
    });

    it('điện nước trong summary khớp với endpoint của trưởng phòng', async () => {
      const { listing, houseId, admin } = await setup();
      const [m1, m2] = previousMonthKeys(new Date());
      for (const [key, amount] of [
        [m1, 1_200_000],
        [m2, 1_350_000],
      ] as const) {
        await fx.prisma.expense.create({
          data: {
            houseId,
            payerId: admin.id,
            createdById: admin.id,
            title: `Điện ${key}`,
            category: 'ELECTRICITY',
            totalAmount: amount,
            splitType: 'EQUAL',
            spentAt: new Date(monthRange(key).start.getTime() + 9 * 86_400_000),
            splits: { create: [{ userId: admin.id, allocatedAmount: amount }] },
          },
        });
      }

      const pub = await publicGet(listing.slug).expect(200);
      const adm = await fx.as(admin.token).get(adminUrl(houseId)).expect(200);

      expect(pub.body.summary).toEqual(adm.body.summary);
      expect(pub.body.summary.utilities).toEqual({ avgMonthlyTotal: 1_275_000, perPerson: 318_750, monthsUsed: 2 });
      expect(pub.body.estimatedPerPerson).toBe(adm.body.estimatedPerPerson);
    });

    it('lịch trực: nhãn TV1…, bỏ ca hủy / vòng quay / chưa giao, không có tên thật', async () => {
      const { listing, houseId } = await setup();
      await addRoster(houseId, (await fx.prisma.houseMember.findMany({ where: { houseId } })).map((m) => m.id));

      const res = await publicGet(listing.slug).expect(200);

      const { roster } = res.body;
      expect(roster.weekKey).toBe(weekKeyFromStart(currentWeekStart()));
      expect(roster.rows).toHaveLength(1);
      expect(roster.rows[0].title).toBe('Rửa chén');
      const cells: string[][] = roster.rows[0].cells;
      expect(cells).toHaveLength(7);
      expect(cells[0]).toHaveLength(1); // T2
      expect(cells[1]).toHaveLength(1); // T3
      expect(cells[2]).toEqual([]); // CANCELLED
      expect(cells[3]).toEqual([]); // WHEEL
      expect(cells[4]).toEqual([]); // UNASSIGNED
      expect(cells[6]).toHaveLength(1); // CN
      expect(cells[0][0]).toBe(cells[6][0]); // cùng người cùng nhãn
      expect(new Set([cells[0][0], cells[1][0]])).toEqual(new Set(['TV1', 'TV2']));
    });

    it('người đã rời nhà không xuất hiện trong lịch', async () => {
      const { listing, houseId, member, memberId, admin } = await setup();
      await addRoster(houseId, [memberId(admin), memberId(member)]);
      await fx.prisma.houseMember.update({ where: { id: memberId(member) }, data: { leftAt: new Date() } });

      const res = await publicGet(listing.slug).expect(200);

      const cells: string[][] = res.body.roster.rows[0].cells;
      expect(cells[1]).toEqual([]);
      expect(cells[0]).toHaveLength(1);
      expect(res.body.summary.memberCount).toBe(1);
    });

    it('showChoreSchedule = false → không có roster (null)', async () => {
      const { listing, houseId } = await setup({ showChoreSchedule: false });
      await addRoster(houseId, (await fx.prisma.houseMember.findMany({ where: { houseId } })).map((m) => m.id));

      const res = await publicGet(listing.slug).expect(200);

      expect(res.body.roster).toBeNull();
    });

    it('tuần chưa có lịch → roster null và không ghi gì (WeekSchedule, ChoreAssignment không đổi)', async () => {
      const { listing, houseId } = await setup();
      const count = async () => ({
        schedules: await fx.prisma.weekSchedule.count({ where: { houseId } }),
        assignments: await fx.prisma.choreAssignment.count({ where: { houseId } }),
        chores: await fx.prisma.chore.count({ where: { houseId } }),
        listings: await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId }, select: { updatedAt: true } }),
      });
      const before = await count();

      const res = await publicGet(listing.slug).expect(200);
      await publicGet(listing.slug).expect(200);

      expect(res.body.roster).toBeNull();
      expect(await count()).toEqual(before);
    });

    it('nhà đã đủ người nhưng tin vẫn OPEN (thêm bằng Prisma, bỏ qua join) → bản rút gọn FULL, không ghi', async () => {
      const { listing, houseId } = await setup();
      for (const name of ['Người 3', 'Người 4']) {
        const u = await fx.user(name);
        await fx.prisma.houseMember.create({ data: { houseId, userId: u.id, role: 'ROOMMATE' } });
      }

      const res = await publicGet(listing.slug).expect(200);

      expect(Object.keys(res.body).sort()).toEqual(['closeReason', 'coverUrl', 'locationText', 'slug', 'status']);
      expect(res.body).toMatchObject({
        slug: listing.slug,
        status: 'CLOSED',
        closeReason: 'FULL',
        coverUrl: 'https://res.cloudinary.com/demo/image/upload/v1/b1.jpg',
      });
      expect(JSON.stringify(res.body)).not.toContain(LISTING_PHONE);
      // Lớp phòng thủ chỉ hiển thị, không sửa DB.
      expect((await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId } })).status).toBe('OPEN');
    });
  });

  describe('tin đã đóng', () => {
    it('CLOSED thủ công → 200 bản rút gọn: không contact, không roster, không giá, không ảnh ngoài coverUrl', async () => {
      const { listing, houseId } = await setup({ status: 'CLOSED' });
      await addRoster(houseId, (await fx.prisma.houseMember.findMany({ where: { houseId } })).map((m) => m.id));

      const res = await publicGet(listing.slug).expect(200);

      expect(res.body).toEqual({
        slug: listing.slug,
        status: 'CLOSED',
        closeReason: 'MANUAL',
        locationText: 'Hẻm 51 Linh Trung, Thủ Đức',
        coverUrl: 'https://res.cloudinary.com/demo/image/upload/v1/b1.jpg',
      });
      expect(res.headers['cache-control']).toBe('no-store');
      for (const secret of await secrets(houseId)) expect(JSON.stringify(res.body)).not.toContain(secret);
    });

    it('CLOSED không có ảnh phòng ngủ → coverUrl null', async () => {
      const { listing } = await setup({ status: 'CLOSED' });
      await fx.prisma.listingPhoto.deleteMany({ where: { listingId: listing.id, category: 'BEDROOM' } });
      const res = await publicGet(listing.slug).expect(200);
      expect(res.body.coverUrl).toBeNull();
    });

    it('slug không đổi qua việc đóng; mở lại thì trang công khai hiện đầy đủ lại', async () => {
      const { listing, houseId, admin } = await setup();
      await fx.as(admin.token).patch(`${adminUrl(houseId)}/status`, { status: 'CLOSED' }).expect(200);
      expect((await publicGet(listing.slug).expect(200)).body.status).toBe('CLOSED');

      await fx.as(admin.token).patch(`${adminUrl(houseId)}/status`, { status: 'OPEN' }).expect(200);

      const res = await publicGet(listing.slug).expect(200);
      expect(res.body).toMatchObject({ slug: listing.slug, status: 'OPEN', contact: { phone: LISTING_PHONE } });
    });
  });

  describe('không tìm thấy', () => {
    it('tin DRAFT (tạm ẩn) → 404 LISTING_NOT_FOUND', async () => {
      const { listing } = await setup({ status: 'DRAFT' });
      const res = await publicGet(listing.slug).expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'LISTING_NOT_FOUND' });
    });

    it('slug đúng định dạng nhưng không tồn tại → 404 LISTING_NOT_FOUND', async () => {
      const res = await publicGet('Zz9Zz9Zz').expect(404);
      expect(res.body).toMatchObject({ code: 'LISTING_NOT_FOUND' });
    });

    it.each([
      ['7 ký tự', 'x7Kp2Qm'],
      ['9 ký tự', 'x7Kp2QmAb'],
      ['có dấu gạch', 'x7Kp-2Qm'],
      ['đường dẫn lên thư mục cha (đã mã hóa)', '..%2Fx'],
      ['ký tự lạ', '%E1%BB%91%E1%BB%91%E1%BB%91%E1%BB%91'],
      ['dấu phần trăm', '%25%25%25%25%25%25%25%25'],
      ['SQL', "'%20OR%201=1--"],
    ])('slug %s → 404 LISTING_NOT_FOUND, không phải 500', async (_label, slug) => {
      const res = await publicGet(slug).expect(404);
      expect(res.body).toMatchObject({ statusCode: 404, code: 'LISTING_NOT_FOUND' });
    });

    it('đường dẫn ../x không mã hóa → 404 (không khớp route), không phải 500', async () => {
      await fx.http().get('/api/v1/public/listings/../x').expect(404);
    });

    it('không có slug → 404', async () => {
      await fx.http().get('/api/v1/public/listings/').expect(404);
    });
  });

  describe('không ghi dữ liệu và không cần JWT', () => {
    it('token sai vẫn xem được (không có JwtAuthGuard); chỉ cho phương thức GET', async () => {
      const { listing } = await setup();
      await publicGet(listing.slug).set('Authorization', 'Bearer khong-hop-le').expect(200);
      await fx.http().post(`/api/v1/public/listings/${listing.slug}`).send({}).expect(404);
      await fx.http().put(`/api/v1/public/listings/${listing.slug}`).send({}).expect(404);
      await fx.http().delete(`/api/v1/public/listings/${listing.slug}`).expect(404);
    });

    it('xem nhiều lần không đổi dòng tin (updatedAt, status, publishedAt)', async () => {
      const { listing } = await setup();
      for (let i = 0; i < 3; i++) await publicGet(listing.slug).expect(200);
      const after = await fx.prisma.roomListing.findUniqueOrThrow({ where: { id: listing.id } });
      expect(after.updatedAt).toEqual(listing.updatedAt);
      expect(after.status).toBe('OPEN');
    });
  });
});

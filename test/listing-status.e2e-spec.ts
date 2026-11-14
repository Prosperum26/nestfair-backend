import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import { closeListingIfFull } from '../src/modules/listing/close-if-full.js';
import { createFixture } from './support/house-fixture.js';

/** Đăng, ẩn, đóng, mở lại tin (Issue #11, B6). */
describe('Listing status API (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const DOMAIN = '@e2e-listing-status.nestfair.test';

  const listingBody = {
    locationText: 'Hẻm 51 Linh Trung, Thủ Đức',
    genderWanted: 'ANY',
    rentPerMonth: 1_200_000,
    contactPhone: '0901234567',
  };

  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await fx.cleanup();
  });

  const base = (houseId: string) => `/api/v1/houses/${houseId}/listing`;
  const setStatus = (token: string, houseId: string, status: unknown) =>
    fx.as(token).patch(`${base(houseId)}/status`, { status });
  const emitSpy = () => vi.spyOn(fx.app.get(EventsService), 'emitToHouse');

  /**
   * Nhà 2 người, `maxMembers` = 4 (còn 2 chỗ) và đã có tin DRAFT.
   * `photos` = true thì đủ ảnh ba nhóm (tạo thẳng bằng Prisma).
   */
  async function setup({ photos = true, maxMembers = 4 }: { photos?: boolean; maxMembers?: number } = {}) {
    const house = await fx.houseWith(['Trưởng phòng', 'Thành viên']);
    const admin = house.users[0];
    const member = house.users[1];
    await fx.prisma.house.update({ where: { id: house.houseId }, data: { maxMembers } });
    await fx.as(admin.token).put(base(house.houseId), listingBody).expect(200);
    const listing = await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId: house.houseId } });
    if (photos) {
      await fx.prisma.listingPhoto.createMany({
        data: (['BEDROOM', 'BATHROOM', 'LIVING'] as const).map((category) => ({
          listingId: listing.id,
          category,
          sortOrder: 0,
          url: `https://res.cloudinary.com/demo/image/upload/v1/nestfair/seed/${category}.jpg`,
        })),
      });
    }
    return { ...house, admin, member, listing };
  }

  const row = (houseId: string) => fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId } });

  describe('đăng (→ OPEN)', () => {
    it('thiếu ảnh → 422 LISTING_INCOMPLETE kèm missing; vẫn là DRAFT; không phát event', async () => {
      const { houseId, admin, listing } = await setup({ photos: false });
      await fx.prisma.listingPhoto.create({
        data: { listingId: listing.id, category: 'BEDROOM', sortOrder: 0, url: 'https://x/a.jpg' },
      });
      const emit = emitSpy();

      const res = await setStatus(admin.token, houseId, 'OPEN').expect(422);

      expect(res.body).toMatchObject({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: 'LISTING_INCOMPLETE',
        missing: ['PHOTO_BATHROOM', 'PHOTO_LIVING'],
      });
      expect((await row(houseId)).status).toBe('DRAFT');
      expect(emit).not.toHaveBeenCalled();
    });

    it('nhà đã đủ người → 409 HOUSE_FULL (kể cả khi vừa thiếu ảnh)', async () => {
      const full = await setup({ maxMembers: 2 });
      const noPhotos = await setup({ maxMembers: 2, photos: false });
      const emit = emitSpy();

      const a = await setStatus(full.admin.token, full.houseId, 'OPEN').expect(409);
      const b = await setStatus(noPhotos.admin.token, noPhotos.houseId, 'OPEN').expect(409);

      expect(a.body).toMatchObject({ code: 'HOUSE_FULL', statusCode: 409 });
      expect(b.body).toMatchObject({ code: 'HOUSE_FULL' });
      expect((await row(full.houseId)).status).toBe('DRAFT');
      expect(emit).not.toHaveBeenCalled();
    });

    it('thành công: OPEN, đặt publishedAt, slug không đổi, trả payload như GET', async () => {
      const { houseId, admin, listing } = await setup();

      const res = await setStatus(admin.token, houseId, 'OPEN').expect(200);

      expect(res.body.listing).toMatchObject({ status: 'OPEN', closeReason: null, closedAt: null, slug: listing.slug });
      expect(res.body.listing.publishedAt).toEqual(expect.any(String));
      expect(res.body).toMatchObject({
        publicUrl: expect.stringContaining(`/r/${listing.slug}`),
        missing: [],
        summary: { memberCount: 2, maxMembers: 4, slotsOpen: 2 },
      });
      const saved = await row(houseId);
      expect(saved.status).toBe('OPEN');
      expect(saved.publishedAt).not.toBeNull();
      expect(saved.slug).toBe(listing.slug);
    });

    it('đăng khi còn đúng 1 chỗ vẫn được', async () => {
      const { houseId, admin } = await setup({ maxMembers: 3 });
      await setStatus(admin.token, houseId, 'OPEN').expect(200);
    });

    it('đăng lại tin đang OPEN → 200, không đổi gì (idempotent)', async () => {
      const { houseId, admin } = await setup();
      await setStatus(admin.token, houseId, 'OPEN').expect(200);
      const before = await row(houseId);

      await setStatus(admin.token, houseId, 'OPEN').expect(200);

      const after = await row(houseId);
      expect(after.publishedAt).toEqual(before.publishedAt);
      expect(after.slug).toBe(before.slug);
    });
  });

  describe('tạm ẩn (OPEN → DRAFT)', () => {
    it('ẩn rồi đăng lại giữ nguyên slug và publishedAt', async () => {
      const { houseId, admin, listing } = await setup();
      await setStatus(admin.token, houseId, 'OPEN').expect(200);
      const published = await row(houseId);

      const hidden = await setStatus(admin.token, houseId, 'DRAFT').expect(200);
      expect(hidden.body.listing).toMatchObject({ status: 'DRAFT', slug: listing.slug });
      const reopened = await setStatus(admin.token, houseId, 'OPEN').expect(200);

      expect(reopened.body.listing.slug).toBe(listing.slug);
      expect(new Date(reopened.body.listing.publishedAt).toISOString()).toBe(published.publishedAt!.toISOString());
    });

    it('ẩn tin DRAFT (cùng trạng thái) → 200, không phát event', async () => {
      const { houseId, admin } = await setup();
      const emit = emitSpy();
      await setStatus(admin.token, houseId, 'DRAFT').expect(200);
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('đóng tay (→ CLOSED)', () => {
    it('đóng tin OPEN: CLOSED/MANUAL, đặt closedAt, phát listing:closed đúng một lần', async () => {
      const { houseId, admin, listing } = await setup();
      await setStatus(admin.token, houseId, 'OPEN').expect(200);
      const emit = emitSpy();

      const res = await setStatus(admin.token, houseId, 'CLOSED').expect(200);

      expect(res.body.listing).toMatchObject({ status: 'CLOSED', closeReason: 'MANUAL', slug: listing.slug });
      expect(res.body.listing.closedAt).toEqual(expect.any(String));
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(houseId, 'listing:closed', { listingId: listing.id, reason: 'MANUAL' });
    });

    it('đóng tin DRAFT cũng được (không cần đủ ảnh), phát event', async () => {
      const { houseId, admin, listing } = await setup({ photos: false });
      const emit = emitSpy();

      await setStatus(admin.token, houseId, 'CLOSED').expect(200);

      expect((await row(houseId)).closeReason).toBe('MANUAL');
      expect(emit).toHaveBeenCalledWith(houseId, 'listing:closed', { listingId: listing.id, reason: 'MANUAL' });
    });

    it('đóng lần hai (đã CLOSED) → 200 nhưng không phát event lần nữa', async () => {
      const { houseId, admin } = await setup();
      await setStatus(admin.token, houseId, 'CLOSED').expect(200);
      const emit = emitSpy();

      await setStatus(admin.token, houseId, 'CLOSED').expect(200);

      expect(emit).not.toHaveBeenCalled();
    });

    it('CLOSED → DRAFT → 422 LISTING_STATUS_INVALID; không đổi, không phát event', async () => {
      const { houseId, admin } = await setup();
      await setStatus(admin.token, houseId, 'CLOSED').expect(200);
      const emit = emitSpy();

      const res = await setStatus(admin.token, houseId, 'DRAFT').expect(422);

      expect(res.body).toMatchObject({ code: 'LISTING_STATUS_INVALID' });
      expect((await row(houseId)).status).toBe('CLOSED');
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('mở lại (CLOSED → OPEN)', () => {
    it('đủ người → 409 HOUSE_FULL; một thành viên rời đi thì mở lại được, xóa closeReason và closedAt, giữ slug', async () => {
      const { houseId, admin, member, memberId, listing } = await setup({ maxMembers: 2 });
      await fx.prisma.roomListing.update({
        where: { id: listing.id },
        data: { status: 'CLOSED', closeReason: 'FULL', closedAt: new Date(), publishedAt: new Date('2026-10-04T03:00:00Z') },
      });

      const full = await setStatus(admin.token, houseId, 'OPEN').expect(409);
      expect(full.body).toMatchObject({ code: 'HOUSE_FULL' });
      expect((await row(houseId)).status).toBe('CLOSED');

      await fx.prisma.houseMember.update({ where: { id: memberId(member) }, data: { leftAt: new Date() } });
      const res = await setStatus(admin.token, houseId, 'OPEN').expect(200);

      expect(res.body.listing).toMatchObject({ status: 'OPEN', closeReason: null, closedAt: null, slug: listing.slug });
      expect(res.body.listing.publishedAt).toBe('2026-10-04T03:00:00.000Z');
      expect(res.body.summary).toMatchObject({ memberCount: 1, slotsOpen: 1 });
    });

    it('thiếu ảnh → 422 LISTING_INCOMPLETE kèm missing', async () => {
      const { houseId, admin, listing } = await setup({ photos: false });
      await fx.prisma.roomListing.update({
        where: { id: listing.id },
        data: { status: 'CLOSED', closeReason: 'MANUAL', closedAt: new Date() },
      });

      const res = await setStatus(admin.token, houseId, 'OPEN').expect(422);

      expect(res.body).toMatchObject({
        code: 'LISTING_INCOMPLETE',
        missing: ['PHOTO_BEDROOM', 'PHOTO_BATHROOM', 'PHOTO_LIVING'],
      });
    });
  });

  describe('quyền và đầu vào', () => {
    it('thành viên thường → 403; tin không đổi', async () => {
      const { houseId, member } = await setup();
      await setStatus(member.token, houseId, 'OPEN').expect(403);
      expect((await row(houseId)).status).toBe('DRAFT');
    });

    it('người ngoài nhà và trưởng phòng nhà khác → 403', async () => {
      const a = await setup();
      const b = await setup();
      const outsider = await fx.user('Người ngoài');
      await setStatus(outsider.token, a.houseId, 'OPEN').expect(403);
      await setStatus(b.admin.token, a.houseId, 'OPEN').expect(403);
      expect((await row(a.houseId)).status).toBe('DRAFT');
    });

    it('chưa có tin → 404 LISTING_NOT_FOUND', async () => {
      const { houseId, users } = await fx.houseWith(['Trưởng phòng', 'Thành viên']);
      const res = await setStatus(users[0].token, houseId, 'OPEN').expect(404);
      expect(res.body).toMatchObject({ code: 'LISTING_NOT_FOUND' });
    });

    it.each([['FOO'], ['open'], [''], [null], [undefined], [1]])('status %j không hợp lệ → 400', async (status) => {
      const { houseId, admin } = await setup();
      await setStatus(admin.token, houseId, status).expect(400);
    });

    it('body có field lạ (slug, closeReason) → 400', async () => {
      const { houseId, admin } = await setup();
      await fx.as(admin.token).patch(`${base(houseId)}/status`, { status: 'OPEN', slug: 'abcdefgh' }).expect(400);
      await fx.as(admin.token).patch(`${base(houseId)}/status`, { status: 'CLOSED', closeReason: 'FULL' }).expect(400);
    });

    it('không có token → 401', async () => {
      const { houseId } = await setup();
      await fx.http().patch(`${base(houseId)}/status`).send({ status: 'OPEN' }).expect(401);
    });
  });

  describe('chạy đua với join', () => {
    it('đăng khi nhà còn 1 chỗ và một người vào cùng lúc: kết quả nhất quán với số thành viên', async () => {
      // Nhà 2 người, tối đa 3. Người thứ 3 vào song song với lệnh đăng.
      const { houseId, admin } = await setup({ maxMembers: 3 });
      const house = await fx.prisma.house.findUniqueOrThrow({ where: { id: houseId } });
      const newcomer = await fx.user('Người mới');

      const [pub, join] = await Promise.all([
        setStatus(admin.token, houseId, 'OPEN'),
        fx.as(newcomer.token).post('/api/v1/houses/join', { inviteCode: house.inviteCode }),
      ]);

      expect(join.status).toBe(200);
      // Đăng chạy trước join → 200 (B8 sẽ tự đóng); đăng chạy sau join → nhà đã đủ → 409. Không có kết quả khác.
      expect([200, 409]).toContain(pub.status);
      const listing = await row(houseId);
      if (pub.status === 409) expect(listing.status).toBe('DRAFT');
    });
  });

  describe('closeListingIfFull', () => {
    const run = (houseId: string, memberCount: number, maxMembers: number, now?: Date) =>
      fx.prisma.$transaction((tx) => closeListingIfFull(tx, houseId, memberCount, maxMembers, now));

    it('đủ người và tin OPEN → CLOSED/FULL, đặt closedAt, trả listingId', async () => {
      const { houseId, listing } = await setup();
      await fx.prisma.roomListing.update({ where: { id: listing.id }, data: { status: 'OPEN' } });
      const now = new Date('2026-11-05T10:00:00.000Z');

      const result = await run(houseId, 4, 4, now);

      expect(result).toEqual({ listingId: listing.id });
      expect(await row(houseId)).toMatchObject({ status: 'CLOSED', closeReason: 'FULL', closedAt: now, slug: listing.slug });
    });

    it('còn chỗ → null, tin vẫn OPEN', async () => {
      const { houseId, listing } = await setup();
      await fx.prisma.roomListing.update({ where: { id: listing.id }, data: { status: 'OPEN' } });

      expect(await run(houseId, 3, 4)).toBeNull();
      expect((await row(houseId)).status).toBe('OPEN');
    });

    it.each(['DRAFT', 'CLOSED'] as const)('tin %s → null, không đổi', async (status) => {
      const { houseId, listing } = await setup();
      await fx.prisma.roomListing.update({
        where: { id: listing.id },
        data:
          status === 'CLOSED' ? { status, closeReason: 'MANUAL', closedAt: new Date() } : { status },
      });

      expect(await run(houseId, 4, 4)).toBeNull();
      expect(await row(houseId)).toMatchObject({ status, closeReason: status === 'CLOSED' ? 'MANUAL' : null });
    });

    it('nhà không có tin → null', async () => {
      const { houseId } = await fx.houseWith(['Trưởng phòng', 'Thành viên']);
      expect(await run(houseId, 2, 2)).toBeNull();
    });
  });
});

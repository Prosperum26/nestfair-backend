import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { png } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

/** API ảnh theo nhóm của tin đăng (Issue #11, B5). Cloudinary được thay bằng mock. */
describe('Listing photos API (e2e)', () => {
  const upload = vi.fn();
  const destroy = vi.fn();
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let seq = 0;
  const DOMAIN = '@e2e-listing-photos.nestfair.test';

  const listingBody = {
    locationText: 'Hẻm 51 Linh Trung, Thủ Đức',
    genderWanted: 'ANY',
    rentPerMonth: 1_200_000,
    contactPhone: '0901234567',
  };

  beforeAll(async () => {
    fx = await createFixture(DOMAIN, (b) => b.overrideProvider(CloudinaryService).useValue({ upload, destroy }));
  });

  beforeEach(() => {
    upload.mockReset();
    destroy.mockReset();
    upload.mockImplementation(async (_buf: Buffer, folder: string) => {
      const n = ++seq;
      return {
        url: `https://res.cloudinary.com/demo/image/upload/v1/nestfair/${folder}/p${n}.jpg`,
        publicId: `nestfair/${folder}/p${n}`,
      };
    });
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  const base = (houseId: string) => `/api/v1/houses/${houseId}/listing`;

  /** Ảnh JPEG giả: đủ magic bytes, phần còn lại ngẫu nhiên. */
  const jpeg = (size = 2048) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size - 4)]);

  function post(
    token: string,
    houseId: string,
    category: string | undefined,
    file?: { buf: Buffer; type: string; name?: string },
  ) {
    let req = fx.http().post(`${base(houseId)}/photos`).set('Authorization', `Bearer ${token}`);
    if (category !== undefined) req = req.field('category', category);
    return file ? req.attach('photo', file.buf, { filename: file.name ?? 'a.jpg', contentType: file.type }) : req;
  }
  const good = () => ({ buf: jpeg(), type: 'image/jpeg' });

  /** Nhà có sẵn tin DRAFT (tạo qua API thật). */
  async function withListing() {
    const house = await fx.houseWith(['Trưởng phòng', 'Thành viên']);
    const admin = house.users[0];
    const member = house.users[1];
    await fx.as(admin.token).put(base(house.houseId), listingBody).expect(200);
    const listing = await fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId: house.houseId } });
    return { ...house, admin, member, listing };
  }

  /** Thêm ảnh thẳng bằng Prisma để dựng trạng thái nhanh. */
  const seedPhoto = (listingId: string, category: 'BEDROOM' | 'BATHROOM' | 'LIVING', sortOrder: number, name = 'x') =>
    fx.prisma.listingPhoto.create({
      data: {
        listingId,
        category,
        sortOrder,
        url: `https://res.cloudinary.com/demo/image/upload/v1/nestfair/seed/${name}${sortOrder}.jpg`,
      },
    });

  describe('POST /houses/:houseId/listing/photos', () => {
    it('ảnh jpeg hợp lệ → 201 và trả ảnh; thư mục upload theo nhà; lưu DB', async () => {
      const { houseId, admin, listing } = await withListing();

      const res = await post(admin.token, houseId, 'BEDROOM', good()).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        category: 'BEDROOM',
        url: expect.stringMatching(/^https:\/\/res\.cloudinary\.com\//),
        sortOrder: 0,
      });
      expect(upload).toHaveBeenCalledWith(expect.any(Buffer), `houses/${houseId}/listing`);
      const saved = await fx.prisma.listingPhoto.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(saved).toMatchObject({ listingId: listing.id, category: 'BEDROOM', url: res.body.url });
    });

    it('sortOrder tăng dần trong từng nhóm, các nhóm đánh số riêng', async () => {
      const { houseId, admin } = await withListing();

      const a = await post(admin.token, houseId, 'BEDROOM', good()).expect(201);
      const b = await post(admin.token, houseId, 'BEDROOM', good()).expect(201);
      const c = await post(admin.token, houseId, 'BEDROOM', good()).expect(201);
      const w = await post(admin.token, houseId, 'BATHROOM', good()).expect(201);

      expect([a, b, c].map((r) => r.body.sortOrder)).toEqual([0, 1, 2]);
      expect(w.body.sortOrder).toBe(0);
    });

    it('nhận png và webp', async () => {
      const { houseId, admin } = await withListing();
      await post(admin.token, houseId, 'LIVING', { buf: png(), type: 'image/png', name: 'a.png' }).expect(201);
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(64)]);
      await post(admin.token, houseId, 'LIVING', { buf: webp, type: 'image/webp', name: 'a.webp' }).expect(201);
    });

    it('file .txt hoặc giả MIME → 415 UNSUPPORTED_IMAGE; không gọi upload', async () => {
      const { houseId, admin } = await withListing();

      const txt = await post(admin.token, houseId, 'BEDROOM', {
        buf: Buffer.from('hello'),
        type: 'text/plain',
        name: 'a.txt',
      }).expect(415);
      const fake = await post(admin.token, houseId, 'BEDROOM', {
        buf: Buffer.from('not an image'),
        type: 'image/png',
      }).expect(415);

      expect(txt.body).toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
      expect(fake.body).toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
      expect(upload).not.toHaveBeenCalled();
    });

    it('ảnh lớn hơn 5MB → 413 IMAGE_TOO_LARGE; không gọi upload', async () => {
      const { houseId, admin } = await withListing();

      const res = await post(admin.token, houseId, 'BEDROOM', {
        buf: jpeg(5 * 1024 * 1024 + 1),
        type: 'image/jpeg',
      }).expect(413);

      expect(res.body).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
      expect(upload).not.toHaveBeenCalled();
    });

    it('thiếu file → 400; không gọi upload', async () => {
      const { houseId, admin } = await withListing();
      const res = await post(admin.token, houseId, 'BEDROOM').expect(400);
      expect(res.body).toMatchObject({ statusCode: 400 });
      expect(upload).not.toHaveBeenCalled();
    });

    it.each([['LAUNDRY'], ['bedroom'], ['']])('category "%s" không hợp lệ → 400', async (category) => {
      const { houseId, admin } = await withListing();
      await post(admin.token, houseId, category, good()).expect(400);
      expect(upload).not.toHaveBeenCalled();
    });

    it('thiếu category → 400', async () => {
      const { houseId, admin } = await withListing();
      await post(admin.token, houseId, undefined, good()).expect(400);
    });

    it('field lạ trong form (vd. listingId, houseId) → 400', async () => {
      const { houseId, admin } = await withListing();
      await post(admin.token, houseId, 'BEDROOM', good()).field('houseId', houseId).expect(400);
    });

    it('ảnh thứ 7 của một nhóm → 422 PHOTO_LIMIT; nhóm khác vẫn thêm được', async () => {
      const { houseId, admin, listing } = await withListing();
      for (let i = 0; i < 6; i++) await seedPhoto(listing.id, 'BEDROOM', i);

      const res = await post(admin.token, houseId, 'BEDROOM', good()).expect(422);

      expect(res.body).toMatchObject({ code: 'PHOTO_LIMIT' });
      expect(upload).not.toHaveBeenCalled();
      expect(await fx.prisma.listingPhoto.count({ where: { listingId: listing.id, category: 'BEDROOM' } })).toBe(6);
      await post(admin.token, houseId, 'LIVING', good()).expect(201);
    });

    it('chưa có tin → 404 LISTING_NOT_FOUND', async () => {
      const { houseId, users } = await fx.houseWith(['Trưởng phòng', 'Thành viên']);
      const res = await post(users[0].token, houseId, 'BEDROOM', good()).expect(404);
      expect(res.body).toMatchObject({ code: 'LISTING_NOT_FOUND' });
      expect(upload).not.toHaveBeenCalled();
    });

    it('thành viên thường và người ngoài nhà → 403; không gọi upload', async () => {
      const { houseId, member } = await withListing();
      const outsider = await fx.user('Người ngoài');
      await post(member.token, houseId, 'BEDROOM', good()).expect(403);
      await post(outsider.token, houseId, 'BEDROOM', good()).expect(403);
      expect(upload).not.toHaveBeenCalled();
    });

    it('trưởng phòng nhà A không tải ảnh vào tin nhà B', async () => {
      const a = await withListing();
      const b = await withListing();
      await post(a.admin.token, b.houseId, 'BEDROOM', good()).expect(403);
      expect(await fx.prisma.listingPhoto.count({ where: { listingId: b.listing.id } })).toBe(0);
    });

    it('không có token → 401', async () => {
      const { houseId } = await withListing();
      await fx.http().post(`${base(houseId)}/photos`).field('category', 'BEDROOM').attach('photo', jpeg(), 'a.jpg').expect(401);
    });

    it('lưu DB lỗi sau khi upload → xóa ảnh vừa up, không để ảnh mồ côi', async () => {
      const { houseId, admin, listing } = await withListing();
      // Tin bị xóa ngay sau khi upload xong: insert vi phạm khóa ngoại.
      upload.mockImplementationOnce(async (_buf: Buffer, folder: string) => {
        await fx.prisma.roomListing.delete({ where: { id: listing.id } });
        return { url: `https://res.cloudinary.com/demo/image/upload/v1/nestfair/${folder}/orphan.jpg`, publicId: 'nestfair/orphan' };
      });

      await post(admin.token, houseId, 'BEDROOM', good()).expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));

      expect(destroy).toHaveBeenCalledWith('nestfair/orphan');
    });

    it('hai lần tải song song vào nhóm còn 1 chỗ: đúng một ảnh được nhận, sortOrder không trùng', async () => {
      const { houseId, admin, listing } = await withListing();
      for (let i = 0; i < 5; i++) await seedPhoto(listing.id, 'BEDROOM', i);

      const [a, b] = await Promise.all([
        post(admin.token, houseId, 'BEDROOM', good()),
        post(admin.token, houseId, 'BEDROOM', good()),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 422]);
      const photos = await fx.prisma.listingPhoto.findMany({ where: { listingId: listing.id, category: 'BEDROOM' } });
      expect(photos).toHaveLength(6);
      expect(new Set(photos.map((p) => p.sortOrder)).size).toBe(6);
      // Ảnh thua cuộc đã up lên Cloudinary phải bị dọn.
      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('DELETE /houses/:houseId/listing/photos/:photoId', () => {
    it('xóa dòng DB và gọi destroy đúng publicId; trả { ok: true }', async () => {
      const { houseId, admin } = await withListing();
      const up = await post(admin.token, houseId, 'BEDROOM', good()).expect(201);
      const publicId = new URL(up.body.url).pathname.replace(/^\/demo\/image\/upload\/v1\//, '').replace(/\.jpg$/, '');

      const res = await fx.as(admin.token).delete(`${base(houseId)}/photos/${up.body.id}`).expect(200);

      expect(res.body).toEqual({ ok: true });
      expect(await fx.prisma.listingPhoto.count({ where: { id: up.body.id } })).toBe(0);
      expect(destroy).toHaveBeenCalledWith(publicId);
    });

    it('destroy ném lỗi vẫn trả 200 và dòng DB đã xóa', async () => {
      const { houseId, admin } = await withListing();
      const up = await post(admin.token, houseId, 'LIVING', good()).expect(201);
      destroy.mockRejectedValue(new Error('cloudinary down'));

      await fx.as(admin.token).delete(`${base(houseId)}/photos/${up.body.id}`).expect(200);

      expect(await fx.prisma.listingPhoto.count({ where: { id: up.body.id } })).toBe(0);
    });

    it('URL không phải Cloudinary (ảnh seed ngoài) thì chỉ xóa DB, không gọi destroy', async () => {
      const { houseId, admin, listing } = await withListing();
      const photo = await fx.prisma.listingPhoto.create({
        data: { listingId: listing.id, category: 'LIVING', sortOrder: 0, url: '/seed/living.svg' },
      });

      await fx.as(admin.token).delete(`${base(houseId)}/photos/${photo.id}`).expect(200);

      expect(destroy).not.toHaveBeenCalled();
    });

    it('tin OPEN: xóa ảnh cuối của một nhóm → 422 PHOTO_REQUIRED, ảnh còn nguyên', async () => {
      const { houseId, admin, listing } = await withListing();
      const only = await seedPhoto(listing.id, 'BATHROOM', 0, 'wc');
      await fx.prisma.roomListing.update({
        where: { id: listing.id },
        data: { status: 'OPEN', publishedAt: new Date() },
      });

      const res = await fx.as(admin.token).delete(`${base(houseId)}/photos/${only.id}`).expect(422);

      expect(res.body).toMatchObject({ code: 'PHOTO_REQUIRED' });
      expect(await fx.prisma.listingPhoto.count({ where: { id: only.id } })).toBe(1);
      expect(destroy).not.toHaveBeenCalled();
    });

    it('tin OPEN: xóa ảnh khi nhóm còn ảnh khác → 200', async () => {
      const { houseId, admin, listing } = await withListing();
      const first = await seedPhoto(listing.id, 'BATHROOM', 0, 'wc');
      await seedPhoto(listing.id, 'BATHROOM', 1, 'wc');
      await fx.prisma.roomListing.update({ where: { id: listing.id }, data: { status: 'OPEN' } });

      await fx.as(admin.token).delete(`${base(houseId)}/photos/${first.id}`).expect(200);
    });

    it('tin DRAFT: xóa ảnh cuối của nhóm được', async () => {
      const { houseId, admin, listing } = await withListing();
      const only = await seedPhoto(listing.id, 'BATHROOM', 0, 'wc');
      await fx.as(admin.token).delete(`${base(houseId)}/photos/${only.id}`).expect(200);
    });

    it('photoId của nhà khác → 404 và ảnh đó còn nguyên', async () => {
      const a = await withListing();
      const b = await withListing();
      const photoOfB = await seedPhoto(b.listing.id, 'LIVING', 0, 'b');

      await fx.as(a.admin.token).delete(`${base(a.houseId)}/photos/${photoOfB.id}`).expect(404);

      expect(await fx.prisma.listingPhoto.count({ where: { id: photoOfB.id } })).toBe(1);
      expect(destroy).not.toHaveBeenCalled();
    });

    it('photoId không tồn tại → 404; không phải UUID → 400', async () => {
      const { houseId, admin } = await withListing();
      await fx.as(admin.token).delete(`${base(houseId)}/photos/00000000-0000-4000-8000-000000000000`).expect(404);
      await fx.as(admin.token).delete(`${base(houseId)}/photos/khong-phai-uuid`).expect(400);
    });

    it('thành viên thường → 403; ảnh còn nguyên', async () => {
      const { houseId, member, listing } = await withListing();
      const photo = await seedPhoto(listing.id, 'LIVING', 0);
      await fx.as(member.token).delete(`${base(houseId)}/photos/${photo.id}`).expect(403);
      expect(await fx.prisma.listingPhoto.count({ where: { id: photo.id } })).toBe(1);
    });

    it('trưởng phòng nhà A dùng URL nhà B → 403', async () => {
      const a = await withListing();
      const b = await withListing();
      const photoOfB = await seedPhoto(b.listing.id, 'LIVING', 0, 'b');
      await fx.as(a.admin.token).delete(`${base(b.houseId)}/photos/${photoOfB.id}`).expect(403);
    });
  });
});

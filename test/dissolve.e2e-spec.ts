import { vi } from 'vitest';
import { ScheduleService } from '../src/modules/chores/schedule.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { CloudinaryService } from '../src/modules/uploads/cloudinary.service.js';
import { HOUR, makeAssignment } from './support/assignment-fixture.js';
import { createFixture } from './support/house-fixture.js';

// Cần Postgres đang chạy (npm run db:up) và .env hợp lệ.
const DOMAIN = '@e2e-dissolve.nestfair.test';
const img = (path: string) => `https://res.cloudinary.com/demo/image/upload/v1700000000/${path}.jpg`;

describe('Giải tán nhà (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => fx.cleanup());

  const url = (houseId: string) => `/api/v1/houses/${houseId}/dissolve`;
  const noCloud = () => vi.spyOn(fx.app.get(CloudinaryService), 'destroy').mockResolvedValue();

  async function house3() {
    const h = await fx.houseWith(['Hùng', 'Thiện', 'Mai']);
    const name = (await fx.prisma.house.findUniqueOrThrow({ where: { id: h.houseId } })).name;
    return { ...h, H: h.users[0], T: h.users[1], M: h.users[2], name };
  }

  it('thành viên thường không giải tán được (403)', async () => {
    const h = await house3();
    await fx.as(h.T.token).post(url(h.houseId), { confirmName: h.name }).expect(403);
  });

  it('sai tên nhà → 400 CONFIRM_NAME_MISMATCH, nhà còn nguyên', async () => {
    const h = await house3();
    const res = await fx.as(h.H.token).post(url(h.houseId), { confirmName: 'Nhà khác' }).expect(400);
    expect(res.body.code).toBe('CONFIRM_NAME_MISMATCH');
    expect(await fx.prisma.houseMember.count({ where: { houseId: h.houseId, leftAt: null } })).toBe(3);
  });

  it('thiếu confirmName → 400 theo DTO', async () => {
    const h = await house3();
    await fx.as(h.H.token).post(url(h.houseId), {}).expect(400);
  });

  it('còn người nợ → 409 HAS_BALANCE kèm số người còn số dư, chưa giải tán', async () => {
    const h = await house3();
    await fx
      .as(h.H.token)
      .post(`/api/v1/houses/${h.houseId}/expenses`, {
        title: 'Nợ',
        category: 'OTHER',
        totalAmount: 90_000,
        splitType: 'EXACT',
        spentAt: '2026-10-05T12:00:00+07:00',
        splits: [{ userId: h.T.id, amount: 90_000 }],
      })
      .expect(201);

    const res = await fx.as(h.H.token).post(url(h.houseId), { confirmName: h.name }).expect(409);
    expect(res.body).toMatchObject({ code: 'HAS_BALANCE', membersWithBalance: 2 });
    expect((await fx.prisma.house.findUniqueOrThrow({ where: { id: h.houseId } })).dissolvedAt).toBeNull();
  });

  it('giải tán: mọi người rời, mã mời hết hạn, vào bằng mã cũ bị từ chối, nhà biến khỏi danh sách', async () => {
    const h = await house3();
    const code = (await fx.prisma.house.findUniqueOrThrow({ where: { id: h.houseId } })).inviteCode;
    noCloud();

    const res = await fx.as(h.H.token).post(url(h.houseId), { confirmName: `  ${h.name} ` }).expect(200);

    expect(res.body).toMatchObject({ houseId: h.houseId, members: 3, imagesRemoved: 0 });
    const saved = await fx.prisma.house.findUniqueOrThrow({ where: { id: h.houseId } });
    expect(saved.dissolvedAt).toBeInstanceOf(Date);
    expect(await fx.prisma.houseMember.count({ where: { houseId: h.houseId, leftAt: null } })).toBe(0);
    const stranger = await fx.user('Người lạ');
    await fx.as(stranger.token).post('/api/v1/houses/join', { inviteCode: code }).expect(404);
    const mine = await fx.as(h.H.token).get('/api/v1/houses').expect(200);
    expect(mine.body.map((x: { id: string }) => x.id)).not.toContain(h.houseId);
    await fx.as(h.T.token).get(`/api/v1/houses/${h.houseId}`).expect(403);
  });

  it('giải tán hai lần liên tiếp: lần hai bị chặn (không còn là thành viên)', async () => {
    const h = await house3();
    noCloud();
    await fx.as(h.H.token).post(url(h.houseId), { confirmName: h.name }).expect(200);
    await fx.as(h.H.token).post(url(h.houseId), { confirmName: h.name }).expect(403);
  });

  it('đóng việc dở: ca tương lai CANCELLED, nhắc nhở chưa gửi bị xóa, tin đăng đóng và xóa ảnh', async () => {
    const h = await house3();
    noCloud();
    const future = await makeAssignment(fx, h, { assignee: 1, dueAt: new Date(Date.now() + 48 * HOUR) });
    await fx.prisma.reminder.create({
      data: { userId: h.T.id, houseId: h.houseId, title: 'Đổ rác', remindAt: new Date(Date.now() + HOUR), source: 'USER' },
    });
    const listing = await fx.prisma.roomListing.create({
      data: {
        houseId: h.houseId,
        slug: 'abcd1234',
        status: 'OPEN',
        publishedAt: new Date(),
        locationText: 'Hẻm 51',
        rentPerMonth: 1_000_000,
        contactPhone: '0912345678',
        photos: { create: [{ category: 'BEDROOM', url: img('nestfair/listings/x1'), sortOrder: 0 }] },
      },
    });

    await fx.as(h.H.token).post(url(h.houseId), { confirmName: h.name }).expect(200);

    expect((await fx.prisma.choreAssignment.findUniqueOrThrow({ where: { id: future.id } })).status).toBe('CANCELLED');
    expect(await fx.prisma.reminder.count({ where: { houseId: h.houseId } })).toBe(0);
    expect(await fx.prisma.roomListing.findUniqueOrThrow({ where: { id: listing.id } })).toMatchObject({ status: 'CLOSED', closeReason: 'MANUAL' });
    expect(await fx.prisma.listingPhoto.count({ where: { listingId: listing.id } })).toBe(0);
  });

  it('dọn ảnh Cloudinary: gọi destroy cho từng ảnh (minh chứng, tin đăng), không trùng', async () => {
    const h = await house3();
    const destroy = noCloud();
    await makeAssignment(fx, h, { assignee: 1, status: 'DONE', proofImageUrl: img('nestfair/proofs/p1') });
    await fx.prisma.roomListing.create({
      data: {
        houseId: h.houseId,
        slug: 'efgh5678',
        status: 'DRAFT',
        locationText: 'Hẻm 51',
        rentPerMonth: 1_000_000,
        contactPhone: '0912345678',
        photos: {
          create: [
            { category: 'BEDROOM', url: img('nestfair/listings/l1'), sortOrder: 0 },
            { category: 'LIVING', url: img('nestfair/proofs/p1'), sortOrder: 0 },
          ],
        },
      },
    });

    const res = await fx.as(h.H.token).post(url(h.houseId), { confirmName: h.name }).expect(200);

    expect(res.body.imagesRemoved).toBe(2);
    expect(destroy.mock.calls.map((c) => c[0]).sort()).toEqual(['nestfair/listings/l1', 'nestfair/proofs/p1']);
  });

  it('phát house:dissolved tới từng thành viên sau commit', async () => {
    const h = await house3();
    noCloud();
    const dissolved = vi.spyOn(fx.app.get(EventsService), 'dissolveHouse');

    await fx.as(h.H.token).post(url(h.houseId), { confirmName: h.name }).expect(200);

    expect(dissolved).toHaveBeenCalledTimes(1);
    expect(dissolved.mock.calls[0][0]).toBe(h.houseId);
    expect([...dissolved.mock.calls[0][1]].sort()).toEqual([h.H.id, h.T.id, h.M.id].sort());
  });

  it('cron sinh lịch bỏ qua nhà đã giải tán', async () => {
    const h = await house3();
    noCloud();
    await fx.as(h.H.token).post(url(h.houseId), { confirmName: h.name }).expect(200);

    // Có phạm vi để không chạm nhà của file khác (vd. Nhà 12A đang được seed); nhà đã giải tán vẫn phải bị bỏ qua.
    await fx.app.get(ScheduleService).catchUpAll(new Date(), [h.houseId]);

    expect(await fx.prisma.weekSchedule.count({ where: { houseId: h.houseId } })).toBe(0);
  });
});

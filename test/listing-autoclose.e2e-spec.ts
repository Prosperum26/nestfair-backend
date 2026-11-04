import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import { generateSlug } from '../src/modules/listing/algorithms/slug.js';
import { createFixture } from './support/house-fixture.js';

/** Nhà đủ người thì tin OPEN tự đóng (Issue #11, B8). */
describe('Listing auto-close on join (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let url: string;
  const sockets: Socket[] = [];
  const DOMAIN = '@e2e-listing-autoclose.nestfair.test';
  const PHONE = '0912345678';

  beforeAll(async () => {
    fx = await createFixture(DOMAIN);
    await fx.app.listen(0);
    url = `http://localhost:${((fx.app.getHttpServer() as Server).address() as AddressInfo).port}`;
  });

  afterEach(() => {
    sockets.splice(0).forEach((s) => s.close());
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  const joinHouse = (token: string, inviteCode: string) => fx.as(token).post('/api/v1/houses/join', { inviteCode });
  const row = (houseId: string) => fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId } });

  /** Nhà `memberCount` người, tối đa `maxMembers`; `listingStatus` = null thì không có tin. */
  async function setup({
    memberCount = 2,
    maxMembers = 3,
    listingStatus = 'OPEN' as 'DRAFT' | 'OPEN' | 'CLOSED' | null,
  } = {}) {
    const house = await fx.houseWith(Array.from({ length: memberCount }, (_, i) => `Thành viên ${i + 1}`));
    await fx.prisma.house.update({ where: { id: house.houseId }, data: { maxMembers } });
    const inviteCode = (await fx.prisma.house.findUniqueOrThrow({ where: { id: house.houseId } })).inviteCode;
    let listing = null;
    if (listingStatus) {
      listing = await fx.prisma.roomListing.create({
        data: {
          houseId: house.houseId,
          slug: generateSlug(),
          status: listingStatus,
          closeReason: listingStatus === 'CLOSED' ? 'MANUAL' : null,
          closedAt: listingStatus === 'CLOSED' ? new Date() : null,
          publishedAt: listingStatus === 'DRAFT' ? null : new Date(),
          locationText: 'Hẻm 51 Linh Trung',
          rentPerMonth: 1_200_000,
          contactPhone: PHONE,
        },
      });
    }
    return { ...house, inviteCode, listing };
  }

  function connect(token: string): Promise<Socket> {
    const s = io(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    return new Promise((resolve, reject) => {
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  }

  /** Mở socket, vào room nhà và gom mọi event `listing:closed` nhận được. */
  async function listen(token: string, houseId: string) {
    const socket = await connect(token);
    const received: unknown[] = [];
    socket.on('listing:closed', (envelope: { payload: unknown }) => received.push(envelope.payload));
    const ack = (await socket.timeout(3000).emitWithAck('house:join_room', { houseId })) as { ok: boolean };
    expect(ack).toMatchObject({ ok: true });
    return received;
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  it('người vào cuối làm nhà đủ người: tin OPEN → CLOSED/FULL, trang công khai hiện đã đóng và không có liên hệ', async () => {
    const { houseId, inviteCode, listing } = await setup();
    const newcomer = await fx.user('Người thứ ba');

    await joinHouse(newcomer.token, inviteCode).expect(200);

    const saved = await row(houseId);
    expect(saved).toMatchObject({ status: 'CLOSED', closeReason: 'FULL', slug: listing!.slug });
    expect(saved.closedAt).toBeInstanceOf(Date);
    const pub = await fx.http().get(`/api/v1/public/listings/${listing!.slug}`).expect(200);
    expect(pub.body).toMatchObject({ status: 'CLOSED', closeReason: 'FULL', slug: listing!.slug });
    expect(pub.body).not.toHaveProperty('contact');
    expect(JSON.stringify(pub.body)).not.toContain(PHONE);
  });

  it('event listing:closed đến thành viên đang mở socket, đúng một lần, payload { listingId, reason: FULL }', async () => {
    const { houseId, inviteCode, listing, users } = await setup();
    const received = await listen(users[1].token, houseId);
    const newcomer = await fx.user('Người thứ ba');

    await joinHouse(newcomer.token, inviteCode).expect(200);
    await settle();

    expect(received).toEqual([{ listingId: listing!.id, reason: 'FULL' }]);
  });

  it('event chỉ phát SAU khi commit: lúc nhận event, DB đã là CLOSED', async () => {
    const { houseId, inviteCode } = await setup();
    const statusAtEmit: string[] = [];
    vi.spyOn(fx.app.get(EventsService), 'emitToHouse').mockImplementation((id, event) => {
      if (event === 'listing:closed') {
        void fx.prisma.roomListing.findUniqueOrThrow({ where: { houseId: id } }).then((l) => statusAtEmit.push(l.status));
      }
    });
    const newcomer = await fx.user('Người thứ ba');

    await joinHouse(newcomer.token, inviteCode).expect(200);
    await settle();

    expect(statusAtEmit).toEqual(['CLOSED']);
    expect((await row(houseId)).status).toBe('CLOSED');
  });

  it('vào mà chưa đủ người: tin vẫn OPEN, không có event', async () => {
    const { houseId, inviteCode, listing, users } = await setup({ maxMembers: 4 });
    const received = await listen(users[0].token, houseId);
    const newcomer = await fx.user('Người thứ ba');

    await joinHouse(newcomer.token, inviteCode).expect(200);
    await settle();

    expect(await row(houseId)).toMatchObject({ status: 'OPEN', closeReason: null, closedAt: null, slug: listing!.slug });
    expect(received).toEqual([]);
  });

  it('nhà không có tin: join vẫn thành công, không lỗi, không tạo tin', async () => {
    const { houseId, inviteCode } = await setup({ listingStatus: null });
    const newcomer = await fx.user('Người thứ ba');

    await joinHouse(newcomer.token, inviteCode).expect(200);

    expect(await fx.prisma.roomListing.count({ where: { houseId } })).toBe(0);
  });

  it.each(['DRAFT', 'CLOSED'] as const)('tin %s: join làm đủ người vẫn thành công và không đổi tin, không event', async (status) => {
    const { houseId, inviteCode, listing, users } = await setup({ listingStatus: status });
    const before = await row(houseId);
    const received = await listen(users[0].token, houseId);
    const newcomer = await fx.user('Người thứ ba');

    await joinHouse(newcomer.token, inviteCode).expect(200);
    await settle();

    const after = await row(houseId);
    expect(after).toMatchObject({ status, closeReason: before.closeReason, slug: listing!.slug });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(received).toEqual([]);
  });

  it('chạy đua: nhà còn đúng 1 chỗ, hai người join cùng lúc → một 200 và một 409; tin đóng đúng một lần; event đúng một lần', async () => {
    const { houseId, inviteCode, listing, users } = await setup();
    const received = await listen(users[0].token, houseId);
    const [a, b] = await Promise.all([fx.user('Người A'), fx.user('Người B')]);

    const results = await Promise.all([joinHouse(a.token, inviteCode), joinHouse(b.token, inviteCode)]);
    await settle();

    expect(results.map((r) => r.status).sort((x, y) => x - y)).toEqual([200, 409]);
    expect(await fx.prisma.houseMember.count({ where: { houseId, leftAt: null } })).toBe(3);
    expect(await row(houseId)).toMatchObject({ status: 'CLOSED', closeReason: 'FULL' });
    expect(received).toEqual([{ listingId: listing!.id, reason: 'FULL' }]);
  });

  it('chạy đua lặp lại 5 lần trên 5 nhà khác nhau: lần nào cũng đúng một người vào và một event', async () => {
    for (let i = 0; i < 5; i++) {
      const { houseId, inviteCode, users } = await setup();
      const received = await listen(users[0].token, houseId);
      const [a, b] = await Promise.all([fx.user('Người A'), fx.user('Người B')]);

      const results = await Promise.all([joinHouse(a.token, inviteCode), joinHouse(b.token, inviteCode)]);
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(results.map((r) => r.status).sort((x, y) => x - y), `lần ${i + 1}`).toEqual([200, 409]);
      expect(received, `lần ${i + 1}`).toHaveLength(1);
    }
  });

  it('join lỗi không làm đóng tin: đã ở trong nhà → 409; mã sai → 404', async () => {
    const { houseId, inviteCode, users } = await setup({ memberCount: 3, maxMembers: 3 });
    const received = await listen(users[0].token, houseId);

    await joinHouse(users[1].token, inviteCode).expect(409);
    await joinHouse(users[1].token, 'ZZZZZ9').expect(404);
    await settle();

    expect((await row(houseId)).status).toBe('OPEN');
    expect(received).toEqual([]);
  });

  it('người ngoài nhà không nhận event của nhà khác', async () => {
    const a = await setup();
    const b = await setup();
    const received = await listen(b.users[0].token, b.houseId);
    const newcomer = await fx.user('Người thứ ba');

    await joinHouse(newcomer.token, a.inviteCode).expect(200);
    await settle();

    expect(received).toEqual([]);
    expect((await row(b.houseId)).status).toBe('OPEN');
  });

  it('đóng tự động rồi mở lại khi còn chỗ: slug giữ nguyên, trang công khai mở lại', async () => {
    const { houseId, inviteCode, listing, users, memberId } = await setup();
    await fx.prisma.listingPhoto.createMany({
      data: (['BEDROOM', 'BATHROOM', 'LIVING'] as const).map((category) => ({
        listingId: listing!.id,
        category,
        sortOrder: 0,
        url: `https://res.cloudinary.com/demo/image/upload/v1/${category}.jpg`,
      })),
    });
    const newcomer = await fx.user('Người thứ ba');
    await joinHouse(newcomer.token, inviteCode).expect(200);
    await fx.as(users[0].token).patch(`/api/v1/houses/${houseId}/listing/status`, { status: 'OPEN' }).expect(409);

    await fx.prisma.houseMember.update({ where: { id: memberId(users[1]) }, data: { leftAt: new Date() } });
    const reopened = await fx
      .as(users[0].token)
      .patch(`/api/v1/houses/${houseId}/listing/status`, { status: 'OPEN' })
      .expect(200);

    expect(reopened.body.listing).toMatchObject({ status: 'OPEN', closeReason: null, slug: listing!.slug });
    const pub = await fx.http().get(`/api/v1/public/listings/${listing!.slug}`).expect(200);
    expect(pub.body).toMatchObject({ status: 'OPEN', contact: { phone: PHONE } });
  });
});

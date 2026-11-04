import { vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { EventsService } from '../src/modules/events/events.service.js';
import { createFixture } from './support/house-fixture.js';

describe('Events gateway (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    fx = await createFixture('@e2e-events.nestfair.test');
    await fx.app.listen(0);
    url = `http://localhost:${((fx.app.getHttpServer() as Server).address() as AddressInfo).port}`;
  });
  afterEach(() => {
    sockets.splice(0).forEach((s) => s.close());
  });
  afterAll(() => fx.cleanup());

  function open(token: string): Socket {
    const s = io(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    return s;
  }
  function connect(token: string): Promise<Socket> {
    const s = open(token);
    return new Promise((resolve, reject) => {
      s.on('connect', () => resolve(s));
      s.on('disconnect', () => reject(new Error('disconnected')));
      s.on('connect_error', reject);
    });
  }
  const join = (s: Socket, houseId: string) =>
    s.timeout(3000).emitWithAck('house:join_room', { houseId }) as Promise<Record<string, unknown>>;
  const next = <T = Record<string, unknown>>(s: Socket, event: string) => new Promise<T>((resolve) => s.once(event, resolve));
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('T-RT-01: token sai bị từ chối với connect_error AUTH_INVALID', async () => {
    const s = open('bad');
    const err = await new Promise<Error & { data?: { code?: string } }>((resolve) => s.on('connect_error', resolve));
    expect(err.data?.code).toBe('AUTH_INVALID');
    expect(s.connected).toBe(false);
  });

  it('T-RT-01: token đúng tự vào room user và room các nhà đang ở', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const s = await connect(users[1].token);
    await pause(100);
    const got = next(s, 'chore:shuffled');
    fx.app.get(EventsService).emitToHouse(houseId, 'chore:shuffled', { weekKey: '2026-W41' });
    expect(await got).toMatchObject({ type: 'chore:shuffled', houseId, payload: { weekKey: '2026-W41' } });
  });

  it('T-RT-02: join đúng nhà có ack đủ trường; nhà khác thì NOT_A_MEMBER và không nhận event', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const outsider = await fx.user('Người lạ');
    const member = await connect(users[1].token);
    const stranger = await connect(outsider.token);

    const ack = await join(member, houseId);
    expect(ack).toMatchObject({ ok: true, serverNow: expect.any(String) });
    expect(ack.onlineUserIds).toContain(users[1].id);
    expect(await join(stranger, houseId)).toEqual({ ok: false, code: 'NOT_A_MEMBER' });
    expect(await join(stranger, 'không-phải-uuid')).toEqual({ ok: false, code: 'NOT_A_MEMBER' });

    const got = next(member, 'chore:shuffled');
    const leaked = vi.fn();
    stranger.on('chore:shuffled', leaked);
    fx.app.get(EventsService).emitToHouse(houseId, 'chore:shuffled', { weekKey: '2026-W41' });

    expect(await got).toMatchObject({ payload: { weekKey: '2026-W41' } });
    await pause(200);
    expect(leaked).not.toHaveBeenCalled();
  });

  it('nhận event gửi riêng vào room user của mình', async () => {
    const { users } = await fx.houseWith(['Hùng', 'Thiện']);
    const s = await connect(users[0].token);
    const got = next(s, 'reminder:due');
    fx.app.get(EventsService).emitToUser(users[0].id, 'reminder:due', { id: 1 });
    expect(await got).toMatchObject({ type: 'reminder:due', payload: { id: 1 } });
  });

  it('T-RT-05: client gửi sự kiện ghi bị từ chối UNSUPPORTED_EVENT, dữ liệu không đổi', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const s = await connect(users[0].token);
    const before = await fx.prisma.choreAssignment.count({ where: { houseId } });
    const ack = (await s.timeout(3000).emitWithAck('wheel:spin', { houseId, winnerId: users[0].id })) as Record<string, unknown>;
    expect(ack).toEqual({ ok: false, code: 'UNSUPPORTED_EVENT', event: 'wheel:spin' });
    const exception = next(s, 'exception');
    s.emit('chore:verified', { assignmentId: 'x' });
    expect(await exception).toEqual({ code: 'UNSUPPORTED_EVENT', event: 'chore:verified' });
    expect(await fx.prisma.choreAssignment.count({ where: { houseId } })).toBe(before);
  });

  it('presence: người thứ hai vào thì cả nhà nhận presence:update', async () => {
    const { users } = await fx.houseWith(['Hùng', 'Thiện']);
    const a = await connect(users[0].token);
    await pause(100);
    const update = next<{ payload: { onlineUserIds: string[] } }>(a, 'presence:update');
    const b = await connect(users[1].token);
    expect((await update).payload.onlineUserIds.sort()).toEqual([users[0].id, users[1].id].sort());
    const left = next<{ payload: { onlineUserIds: string[] } }>(a, 'presence:update');
    b.close();
    expect((await left).payload.onlineUserIds).toEqual([users[0].id]);
  });

  it('vào nhà bằng mã mời: socket đang mở vào room nhà mới, cả nhà nhận member:joined', async () => {
    const { users } = await fx.houseWith(['Hùng']);
    const admin = await connect(users[0].token);
    const newbie = await fx.user('Quân');
    const newbieSocket = await connect(newbie.token);
    const detail = await fx.as(users[0].token).get('/api/v1/houses').expect(200);
    const houseId = detail.body[0].id as string;
    const code = (await fx.as(users[0].token).get(`/api/v1/houses/${houseId}`).expect(200)).body.inviteCode as string;

    const joined = next(admin, 'member:joined');
    await fx.as(newbie.token).post('/api/v1/houses/join', { inviteCode: code }).expect(200);
    expect(await joined).toMatchObject({ type: 'member:joined', payload: { userId: newbie.id, name: 'Quân' } });

    const got = next(newbieSocket, 'chore:shuffled');
    fx.app.get(EventsService).emitToHouse(houseId, 'chore:shuffled', {});
    expect(await got).toMatchObject({ houseId });
  });

  it('removeMemberFromHouse: socket bị đá khỏi room nhà và nhận member:left (chuẩn bị cho #3)', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const s = await connect(users[1].token);
    await pause(100);
    const left = next(s, 'member:left');
    await fx.app.get(EventsService).removeMemberFromHouse(users[1].id, houseId, 'Thiện');
    expect(await left).toMatchObject({ payload: { userId: users[1].id } });
    const leaked = vi.fn();
    s.on('chore:shuffled', leaked);
    fx.app.get(EventsService).emitToHouse(houseId, 'chore:shuffled', {});
    await pause(200);
    expect(leaked).not.toHaveBeenCalled();
  });

  it('đăng xuất thì server ngắt socket của user', async () => {
    const reg = await fx
      .http()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Mai', email: `logout-${Date.now()}@e2e-events.nestfair.test`, phone: '0901234567', password: 'MatKhau123' })
      .expect(201);
    const cookie = ([] as string[]).concat(reg.headers['set-cookie'] ?? []);
    const s = await connect(reg.body.accessToken as string);
    const closed = new Promise<string>((resolve) => s.on('disconnect', resolve));
    await fx.http().post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    expect(await closed).toBe('io server disconnect');
  });
});

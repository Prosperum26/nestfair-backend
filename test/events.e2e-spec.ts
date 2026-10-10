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

  function connect(token: string): Promise<Socket> {
    const s = io(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    return new Promise((resolve, reject) => {
      s.on('connect', () => resolve(s));
      s.on('disconnect', () => reject(new Error('disconnected')));
      s.on('connect_error', reject);
    });
  }
  const join = (s: Socket, houseId: string) =>
    s.timeout(3000).emitWithAck('house:join_room', { houseId }) as Promise<{ ok: boolean }>;

  it('token sai bị ngắt kết nối', async () => {
    const s = io(url, { auth: { token: 'bad' }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    await new Promise<void>((resolve) => s.on('disconnect', () => resolve()));
    expect(s.connected).toBe(false);
  });

  it('thành viên join room nhà mình và nhận event; người ngoài nhà bị từ chối', async () => {
    const { houseId, users } = await fx.houseWith(['Hùng', 'Thiện']);
    const outsider = await fx.user('Người lạ');
    const member = await connect(users[1].token);
    const stranger = await connect(outsider.token);

    expect(await join(member, houseId)).toEqual({ ok: true });
    expect(await join(stranger, houseId)).toEqual({ ok: false });

    const got = new Promise((resolve) => member.on('chore:shuffled', resolve));
    const leaked = vi.fn();
    stranger.on('chore:shuffled', leaked);
    fx.app.get(EventsService).emitToHouse(houseId, 'chore:shuffled', { weekKey: '2026-W41' });

    expect(await got).toEqual({ weekKey: '2026-W41' });
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).not.toHaveBeenCalled();
  });

  it('nhận event gửi riêng vào room user của mình', async () => {
    const { users } = await fx.houseWith(['Hùng', 'Thiện']);
    const s = await connect(users[0].token);
    const got = new Promise((resolve) => s.on('reminder:due', resolve));
    fx.app.get(EventsService).emitToUser(users[0].id, 'reminder:due', { id: 1 });
    expect(await got).toEqual({ id: 1 });
  });
});

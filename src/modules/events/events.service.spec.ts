import { describe, expect, it, vi } from 'vitest';
import { EventsService } from './events.service.js';

function fakeServer() {
  const emit = vi.fn();
  const to = vi.fn((_room: string) => ({ emit }));
  return { server: { to } as never, to, emit };
}

const UUID = /^[0-9a-f-]{36}$/;

describe('EventsService', () => {
  it('emitToHouse gửi envelope vào room house:<id>', () => {
    const { server, to, emit } = fakeServer();
    const svc = new EventsService();
    svc.setServer(server);
    svc.emitToHouse('h1', 'chore:shuffled', { weekKey: '2026-W41' }, { userId: 'u1', name: 'Hùng' });
    expect(to).toHaveBeenCalledWith('house:h1');
    expect(emit).toHaveBeenCalledWith('chore:shuffled', {
      eventId: expect.stringMatching(UUID),
      type: 'chore:shuffled',
      houseId: 'h1',
      occurredAt: expect.any(String),
      actor: { userId: 'u1', name: 'Hùng' },
      payload: { weekKey: '2026-W41' },
    });
  });

  it('emitToUser gửi vào room user:<id>, actor mặc định null', () => {
    const { server, to, emit } = fakeServer();
    const svc = new EventsService();
    svc.setServer(server);
    svc.emitToUser('u1', 'reminder:due', { a: 1 });
    expect(to).toHaveBeenCalledWith('user:u1');
    expect(emit).toHaveBeenCalledWith('reminder:due', expect.objectContaining({ actor: null, houseId: null, payload: { a: 1 } }));
  });

  it('mỗi sự kiện có eventId riêng', () => {
    const { server, emit } = fakeServer();
    const svc = new EventsService();
    svc.setServer(server);
    svc.emitToHouse('h1', 'chore:submitted', {});
    svc.emitToHouse('h1', 'chore:submitted', {});
    const ids = emit.mock.calls.map((c) => (c[1] as { eventId: string }).eventId);
    expect(new Set(ids).size).toBe(2);
  });

  it('chưa có server (chưa init) thì bỏ qua, không ném lỗi', () => {
    expect(() => new EventsService().emitToHouse('h1', 'chore:submitted', {})).not.toThrow();
  });

  it('phát lỗi (socket hỏng) chỉ ghi log, không ném (RT-05)', () => {
    const svc = new EventsService();
    svc.setServer({ to: () => ({ emit: () => { throw new Error('boom'); } }) } as never);
    expect(() => svc.emitToHouse('h1', 'chore:submitted', {})).not.toThrow();
  });
});

describe('Outbox', () => {
  it('chưa flush thì chưa phát gì; flush phát đúng thứ tự rồi rỗng', () => {
    const { server, emit, to } = fakeServer();
    const svc = new EventsService();
    svc.setServer(server);
    const outbox = svc.outbox().toHouse('h1', 'chore:submitted', { n: 1 }).toUser('u1', 'chore:missed', { n: 2 }, { houseId: 'h1' });
    expect(emit).not.toHaveBeenCalled();
    expect(outbox.size).toBe(2);
    outbox.flush();
    expect(to.mock.calls.map((c) => c[0])).toEqual(['house:h1', 'user:u1']);
    expect(emit.mock.calls.map((c) => c[0] as string)).toEqual(['chore:submitted', 'chore:missed']);
    outbox.flush();
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('transaction rollback (không tới flush) thì không phát (RT-04)', async () => {
    const { server, emit } = fakeServer();
    const svc = new EventsService();
    svc.setServer(server);
    const outbox = svc.outbox();
    const tx = async () => {
      outbox.toHouse('h1', 'chore:verified', {});
      throw new Error('rollback');
    };
    await expect(tx().then(() => outbox.flush())).rejects.toThrow('rollback');
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('Presence', () => {
  it('chỉ báo khi user chuyển 0 ↔ 1 socket trong nhà', () => {
    const { server, emit } = fakeServer();
    const svc = new EventsService();
    svc.setServer(server);
    svc.markOnline('h1', 'u1', 's1');
    svc.markOnline('h1', 'u1', 's2');
    svc.markOnline('h1', 'u2', 's3');
    expect(svc.onlineUserIds('h1').sort()).toEqual(['u1', 'u2']);
    expect(emit).toHaveBeenCalledTimes(2);

    svc.markOffline('h1', 'u1', 's1');
    expect(emit).toHaveBeenCalledTimes(2);
    svc.markOffline('h1', 'u1', 's2');
    expect(emit).toHaveBeenCalledTimes(3);
    expect(emit).toHaveBeenLastCalledWith('presence:update', expect.objectContaining({ payload: { onlineUserIds: ['u2'] } }));
    expect(svc.housesOfSocket('s3')).toEqual([{ houseId: 'h1', userId: 'u2' }]);
  });

  it('markOffline socket lạ không làm gì', () => {
    const { server, emit } = fakeServer();
    const svc = new EventsService();
    svc.setServer(server);
    svc.markOffline('h1', 'u1', 'nope');
    expect(emit).not.toHaveBeenCalled();
  });
});

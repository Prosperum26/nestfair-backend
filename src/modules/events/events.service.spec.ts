import { describe, expect, it, vi } from 'vitest';
import { EventsService } from './events.service.js';

function fakeServer() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { server: { to } as never, to, emit };
}

describe('EventsService', () => {
  it('emitToHouse gửi vào room house:<id>', () => {
    const { server, to, emit } = fakeServer();
    const svc = new EventsService();
    svc.setServer(server);
    svc.emitToHouse('h1', 'chore:shuffled', { weekKey: '2026-W41' });
    expect(to).toHaveBeenCalledWith('house:h1');
    expect(emit).toHaveBeenCalledWith('chore:shuffled', { weekKey: '2026-W41' });
  });

  it('emitToUser gửi vào room user:<id>', () => {
    const { server, to, emit } = fakeServer();
    const svc = new EventsService();
    svc.setServer(server);
    svc.emitToUser('u1', 'reminder:due', { a: 1 });
    expect(to).toHaveBeenCalledWith('user:u1');
    expect(emit).toHaveBeenCalledWith('reminder:due', { a: 1 });
  });

  it('chưa có server (chưa init) thì bỏ qua, không ném lỗi', () => {
    expect(() => new EventsService().emitToHouse('h1', 'chore:submitted', {})).not.toThrow();
  });
});

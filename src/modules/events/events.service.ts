import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';

/** Tên event realtime của module việc nhà (AGENTS.md mục 5). */
export type ChoreEvent =
  | 'chore:submitted'
  | 'chore:verified'
  | 'chore:shuffled'
  | 'chore:missed'
  | 'chore:reassigned'
  | 'chore:cancelled';
export type WheelEvent = 'wheel:spinning' | 'wheel:result' | 'wheel:voided';
export type SwapEvent =
  | 'swap:requested'
  | 'swap:accepted'
  | 'swap:rejected'
  | 'swap:expired'
  | 'swap:cancelled'
  | 'swap:escalated';
export type DebtEvent =
  | 'chore_debt:created'
  | 'chore_debt:pick_requested'
  | 'chore_debt:paid'
  | 'chore_debt:forgiven';
export type RealtimeEvent =
  | ChoreEvent
  | WheelEvent
  | SwapEvent
  | DebtEvent
  | 'rotation_swap:applied'
  | 'activity:new'
  | 'presence:update'
  | 'member:joined'
  | 'member:left'
  | 'session:expired'
  | 'reminder:due';

export const houseRoom = (houseId: string) => `house:${houseId}`;
export const userRoom = (userId: string) => `user:${userId}`;

/** Người gây ra sự kiện, tên chụp lúc phát. `null` với cron. */
export interface EventActor {
  userId: string;
  name: string;
}

/** Cấu trúc chung của mọi sự kiện server phát (đặc tả #5 mục 7). */
export interface EventEnvelope<P = unknown> {
  eventId: string;
  type: RealtimeEvent;
  houseId: string | null;
  occurredAt: string;
  actor: EventActor | null;
  payload: P;
}

interface Pending {
  room: string;
  envelope: EventEnvelope;
}

/**
 * Gom sự kiện trong lúc ghi nghiệp vụ, chỉ phát khi gọi `flush()` sau khi transaction commit.
 * Rollback thì không tới `flush()`, nên không có sự kiện "ma".
 */
export class Outbox {
  private readonly pending: Pending[] = [];

  constructor(private readonly events: EventsService) {}

  toHouse(houseId: string, type: RealtimeEvent, payload: unknown, actor: EventActor | null = null): this {
    this.pending.push({ room: houseRoom(houseId), envelope: this.events.envelope(type, houseId, payload, actor) });
    return this;
  }

  toUser(userId: string, type: RealtimeEvent, payload: unknown, opts: { houseId?: string; actor?: EventActor | null } = {}): this {
    this.pending.push({ room: userRoom(userId), envelope: this.events.envelope(type, opts.houseId ?? null, payload, opts.actor ?? null) });
    return this;
  }

  get size(): number {
    return this.pending.length;
  }

  /** Phát mọi sự kiện đã gom (một lần). Lỗi phát chỉ ghi log, không ném (RT-05). */
  flush(): void {
    for (const p of this.pending.splice(0)) this.events.send(p.room, p.envelope);
  }
}

/**
 * Cửa duy nhất để service khác phát event. Socket chỉ để broadcast:
 * mọi thay đổi dữ liệu đã đi qua REST trước khi gọi vào đây.
 * Presence (ai đang online theo nhà) giữ trong bộ nhớ: chỉ đúng với 1 instance.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private server?: Server;
  /** houseId → userId → các socket id đang trong room nhà. */
  private readonly presence = new Map<string, Map<string, Set<string>>>();

  setServer(server: Server) {
    this.server = server;
  }

  envelope<P>(type: RealtimeEvent, houseId: string | null, payload: P, actor: EventActor | null): EventEnvelope<P> {
    return { eventId: randomUUID(), type, houseId, occurredAt: new Date().toISOString(), actor, payload };
  }

  /** Gom sự kiện của một thao tác để phát sau commit. */
  outbox(): Outbox {
    return new Outbox(this);
  }

  /** Phát ngay. Chỉ dùng khi không có transaction (dữ liệu đã ghi xong). */
  emitToHouse(houseId: string, type: RealtimeEvent, payload: unknown, actor: EventActor | null = null) {
    this.send(houseRoom(houseId), this.envelope(type, houseId, payload, actor));
  }

  emitToUser(userId: string, type: RealtimeEvent, payload: unknown, opts: { houseId?: string; actor?: EventActor | null } = {}) {
    this.send(userRoom(userId), this.envelope(type, opts.houseId ?? null, payload, opts.actor ?? null));
  }

  send(room: string, envelope: EventEnvelope) {
    try {
      this.server?.to(room).emit(envelope.type, envelope);
    } catch (e) {
      this.logger.warn(`Phát ${envelope.type} tới ${room} thất bại: ${(e as Error).message}`);
    }
  }

  // ---- Presence ----

  onlineUserIds(houseId: string): string[] {
    return [...(this.presence.get(houseId)?.keys() ?? [])];
  }

  /** Socket vào room nhà. User chuyển 0 → 1 socket thì báo cả nhà. */
  markOnline(houseId: string, userId: string, socketId: string) {
    const house = this.presence.get(houseId) ?? new Map<string, Set<string>>();
    this.presence.set(houseId, house);
    const sockets = house.get(userId) ?? new Set<string>();
    const wasOffline = sockets.size === 0;
    sockets.add(socketId);
    house.set(userId, sockets);
    if (wasOffline) this.emitPresence(houseId);
  }

  /** Socket rời room nhà (hoặc ngắt). User chuyển 1 → 0 socket thì báo cả nhà. */
  markOffline(houseId: string, userId: string, socketId: string) {
    const house = this.presence.get(houseId);
    const sockets = house?.get(userId);
    if (!house || !sockets?.delete(socketId)) return;
    if (sockets.size > 0) return;
    house.delete(userId);
    if (house.size === 0) this.presence.delete(houseId);
    this.emitPresence(houseId);
  }

  /** Mọi nhà mà socket đang được tính online (để dọn khi ngắt). */
  housesOfSocket(socketId: string): { houseId: string; userId: string }[] {
    const out: { houseId: string; userId: string }[] = [];
    for (const [houseId, users] of this.presence) {
      for (const [userId, sockets] of users) if (sockets.has(socketId)) out.push({ houseId, userId });
    }
    return out;
  }

  private emitPresence(houseId: string) {
    this.emitToHouse(houseId, 'presence:update', { onlineUserIds: this.onlineUserIds(houseId) });
  }

  // ---- Thành viên vào / rời nhà ----

  /** Vào nhà: đưa các socket đang mở của người đó vào room nhà mới. Gọi sau commit. */
  async addMemberToHouse(userId: string, houseId: string) {
    if (!this.server) return;
    try {
      const sockets = await this.server.in(userRoom(userId)).fetchSockets();
      for (const s of sockets) {
        s.join(houseRoom(houseId));
        this.markOnline(houseId, userId, s.id);
      }
    } catch (e) {
      this.logger.warn(`Không đưa được socket của ${userId} vào nhà ${houseId}: ${(e as Error).message}`);
    }
  }

  /**
   * Rời nhà / bị xóa: đá mọi socket của người đó khỏi room nhà rồi báo cả nhà (`member:left`).
   * Người rời nhận `member:left` qua room user của mình để client về /onboarding.
   * Issue #3 gọi hàm này khi có API rời nhà.
   */
  async removeMemberFromHouse(userId: string, houseId: string, name: string) {
    if (!this.server) return;
    try {
      const sockets = await this.server.in(userRoom(userId)).fetchSockets();
      for (const s of sockets) {
        s.leave(houseRoom(houseId));
        this.markOffline(houseId, userId, s.id);
      }
    } catch (e) {
      this.logger.warn(`Không đá được socket của ${userId} khỏi nhà ${houseId}: ${(e as Error).message}`);
    }
    const payload = { userId, name };
    this.emitToHouse(houseId, 'member:left', payload);
    this.emitToUser(userId, 'member:left', payload, { houseId });
  }

  /** Đăng xuất: ngắt mọi socket của user. */
  disconnectUser(userId: string) {
    try {
      this.server?.in(userRoom(userId)).disconnectSockets(true);
    } catch (e) {
      this.logger.warn(`Không ngắt được socket của ${userId}: ${(e as Error).message}`);
    }
  }
}

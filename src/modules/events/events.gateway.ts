import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { JwtPayload } from '../auth/auth.service.js';
import { EventsService, houseRoom, userRoom } from './events.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Sự kiện duy nhất client được gửi lên (đặc tả #5 mục 5, nguyên tắc 1). */
const CLIENT_EVENTS = new Set(['house:join_room']);
/** setTimeout tối đa ~24,8 ngày; token 15 phút nên không chạm tới. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export type JoinAck = { ok: true; onlineUserIds: string[]; serverNow: string } | { ok: false; code: 'NOT_A_MEMBER' };

interface SocketData {
  userId?: string;
  expiryTimer?: NodeJS.Timeout;
}

/** Lỗi middleware: client nhận `connect_error` với `err.data.code`. */
function authError(): Error & { data: { code: string } } {
  return Object.assign(new Error('Phiên đăng nhập không hợp lệ'), { data: { code: 'AUTH_INVALID' } });
}

/**
 * Client kết nối kèm `auth: { token }` (access token, không đặt trên query string).
 * - Sai / thiếu token: `connect_error` có `data.code = 'AUTH_INVALID'`.
 * - Đúng: tự vào `user:<id>` và `house:<id>` của mọi nhà còn là thành viên.
 * - `house:join_room` để vào nhà đang xem (chỉ khi còn là thành viên).
 * - Token hết hạn khi đang kết nối: phát `session:expired` rồi ngắt; client làm mới phiên và nối lại.
 * Socket chỉ để server phát xuống: sự kiện khác từ client bị từ chối `UNSUPPORTED_EVENT`.
 */
@WebSocketGateway()
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.events.setServer(server);
    server.use((socket, next) => {
      void this.authenticate(socket).then(
        () => next(),
        () => {
          this.logger.debug('Từ chối kết nối socket: token không hợp lệ');
          next(authError());
        },
      );
    });
  }

  private async authenticate(socket: Socket) {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string') throw new Error('missing token');
    const payload = await this.jwt.verifyAsync<JwtPayload & { exp?: number }>(token);
    const data = socket.data as SocketData;
    data.userId = payload.sub;
    if (payload.exp) {
      const ms = Math.min(payload.exp * 1000 - Date.now(), MAX_TIMER_MS);
      data.expiryTimer = setTimeout(() => {
        socket.emit('session:expired', this.events.envelope('session:expired', null, { code: 'TOKEN_EXPIRED' }, null));
        socket.disconnect(true);
      }, Math.max(ms, 0));
    }
  }

  async handleConnection(client: Socket) {
    const userId = (client.data as SocketData).userId;
    if (!userId) {
      client.disconnect(true);
      return;
    }
    client.onAny((event: string, ...args: unknown[]) => {
      if (CLIENT_EVENTS.has(event)) return;
      const error = { code: 'UNSUPPORTED_EVENT', event };
      const ack = args.at(-1);
      if (typeof ack === 'function') (ack as (r: unknown) => void)({ ok: false, ...error });
      else client.emit('exception', error);
    });
    await client.join(userRoom(userId));
    const memberships = await this.prisma.houseMember.findMany({ where: { userId, leftAt: null }, select: { houseId: true } });
    for (const { houseId } of memberships) {
      await client.join(houseRoom(houseId));
      this.events.markOnline(houseId, userId, client.id);
    }
  }

  handleDisconnect(client: Socket) {
    const data = client.data as SocketData;
    clearTimeout(data.expiryTimer);
    for (const { houseId, userId } of this.events.housesOfSocket(client.id)) this.events.markOffline(houseId, userId, client.id);
  }

  @SubscribeMessage('house:join_room')
  async joinHouse(@ConnectedSocket() client: Socket, @MessageBody() body: { houseId?: unknown }): Promise<JoinAck> {
    const userId = (client.data as SocketData).userId;
    const houseId = body?.houseId;
    if (!userId || typeof houseId !== 'string' || !UUID.test(houseId)) return { ok: false, code: 'NOT_A_MEMBER' };
    const membership = await this.prisma.houseMember.findFirst({
      where: { houseId, userId, leftAt: null },
      select: { id: true },
    });
    if (!membership) return { ok: false, code: 'NOT_A_MEMBER' };
    await client.join(houseRoom(houseId));
    this.events.markOnline(houseId, userId, client.id);
    return { ok: true, onlineUserIds: this.events.onlineUserIds(houseId), serverNow: new Date().toISOString() };
  }
}

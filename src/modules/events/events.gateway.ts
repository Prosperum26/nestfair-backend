import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
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

/**
 * Client kết nối kèm `auth: { token }` (access token). Mỗi kết nối tự vào room
 * `user:<id>`; vào `house:<id>` bằng message `house:join_room` và chỉ khi còn là thành viên.
 */
@WebSocketGateway()
export class EventsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.events.setServer(server);
  }

  async handleConnection(client: Socket) {
    const token: unknown = client.handshake.auth?.token;
    try {
      if (typeof token !== 'string') throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      client.data.userId = payload.sub;
      await client.join(userRoom(payload.sub));
    } catch {
      this.logger.debug('Từ chối kết nối socket: token không hợp lệ');
      client.disconnect(true);
    }
  }

  @SubscribeMessage('house:join_room')
  async joinHouse(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { houseId?: unknown },
  ): Promise<{ ok: boolean }> {
    const userId = client.data.userId as string | undefined;
    const houseId = body?.houseId;
    if (!userId || typeof houseId !== 'string' || !UUID.test(houseId)) {
      return { ok: false };
    }
    const membership = await this.prisma.houseMember.findFirst({
      where: { houseId, userId, leftAt: null },
      select: { id: true },
    });
    if (!membership) return { ok: false };
    await client.join(houseRoom(houseId));
    return { ok: true };
  }
}

import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import type { Env } from '../../config/env.validation.js';
import { parseOrigins } from '../../config/origins.js';

/** Dùng CORS_ORIGINS cho Socket.IO (FE và BE khác origin khi deploy). */
export class SocketIoAdapter extends IoAdapter {
  private readonly origins: string[];

  constructor(app: INestApplicationContext) {
    super(app);
    this.origins = parseOrigins(app.get(ConfigService<Env, true>).get('CORS_ORIGINS', { infer: true }));
  }

  override createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
    } as ServerOptions);
  }
}

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env.validation.js';
import { parseOrigins } from './config/origins.js';
import { SocketIoAdapter } from './modules/events/socket-io.adapter.js';

/** Cấu hình dùng chung cho main.ts và e2e test. */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: parseOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
  });
  app.useWebSocketAdapter(new SocketIoAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

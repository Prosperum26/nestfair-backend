import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventsGateway } from './events.gateway.js';
import { EventsService } from './events.service.js';

/** Global để module khác chỉ cần inject EventsService. */
@Global()
@Module({
  imports: [AuthModule],
  providers: [EventsService, EventsGateway],
  exports: [EventsService],
})
export class EventsModule {}

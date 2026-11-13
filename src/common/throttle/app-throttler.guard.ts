import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Guard throttle toàn cục (APP_GUARD). Chỉ áp cho HTTP: gateway Socket.IO đã xác thực ở handshake,
 * còn ThrottlerGuard gốc không đọc được request/response trong ngữ cảnh ws.
 * Theo IP (`req.ip`), nên cần `trust proxy` đúng khi chạy sau proxy.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.shouldSkip(context);
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service.js';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness cho pinger và health check của Render: không chạm DB (để Neon được ngủ, không tốn CU-giờ).
   * `commit` = 7 ký tự đầu của `RENDER_GIT_COMMIT` (Render tự đặt), để workflow deploy đợi đúng bản mới.
   */
  live(env: NodeJS.ProcessEnv = process.env) {
    return { status: 'ok', commit: env.RENDER_GIT_COMMIT?.slice(0, 7) || 'local' };
  }

  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'up' };
  }
}

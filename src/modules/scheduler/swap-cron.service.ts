import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Env } from '../../config/env.validation.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ChoreDebtService } from '../swaps/chore-debt.service.js';
import { SwapEscalationService } from '../swaps/swap-escalation.service.js';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';

/**
 * Cron của đổi ca. Logic nằm ở service để test gọi trực tiếp với `now` tiêm vào; hàm `@Cron` chỉ là lớp mỏng.
 * Mỗi job an toàn khi chạy nhiều instance (`FOR UPDATE SKIP LOCKED`).
 */
@Injectable()
export class SwapCronService {
  private readonly logger = new Logger(SwapCronService.name);

  constructor(
    private readonly escalation: SwapEscalationService,
    private readonly debts: ChoreDebtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get isTest() {
    return this.config.get('NODE_ENV', { infer: true }) === 'test';
  }

  private async guarded(name: string, job: () => Promise<unknown>) {
    if (this.isTest) return;
    try {
      await job();
    } catch (e) {
      this.logger.error(`Job ${name} thất bại`, e as Error);
    }
  }

  /** Mỗi phút: yêu cầu quá `expiresAt` → EXPIRED. */
  expireSwaps(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    return this.escalation.expireDue(now, houseIds);
  }

  @Cron('* * * * *', { timeZone: TIME_ZONE })
  cronExpireSwaps() {
    return this.guarded('expireSwaps', () => this.expireSwaps());
  }

  /** Hằng ngày: xóa `swap_locks` không còn yêu cầu PENDING tương ứng. Trả số khóa đã xóa. */
  async repairLocks(): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM swap_locks l
      WHERE NOT EXISTS (SELECT 1 FROM chore_swap_requests s WHERE s.id = l."swapRequestId" AND s.status = 'PENDING')`;
  }

  /** Hằng ngày: nợ OPEN quá 4 tuần không xếp được → FORGIVEN (STALE). */
  settleStaleDebts(now: Date = new Date(), houseIds?: string[]): Promise<number> {
    return this.debts.settleStale(now, houseIds);
  }

  @Cron('0 3 * * *', { timeZone: TIME_ZONE })
  cronDaily() {
    return this.guarded('swapDaily', async () => {
      await this.repairLocks();
      await this.settleStaleDebts();
    });
  }
}

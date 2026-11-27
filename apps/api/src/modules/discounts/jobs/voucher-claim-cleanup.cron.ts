import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@api/infrastructure/cache/redis.module';
import { runWithCronLock } from '@api/infrastructure/cache/cron-lock';
import { VoucherClaimsService } from '../voucher-claims.service';

/**
 * Housekeeping only: expired reservations already stop counting the moment they
 * expire (every check filters on expiresAt), so this just keeps the table small.
 */
@Injectable()
export class VoucherClaimCleanupCron {
  private readonly logger = new Logger(VoucherClaimCleanupCron.name);

  constructor(
    private readonly claims: VoucherClaimsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purge(): Promise<void> {
    try {
      await runWithCronLock(
        this.redis,
        'cron:lock:voucher-claim-cleanup',
        15 * 60_000,
        async () => {
          let total = 0;
          for (let i = 0; i < 100; i += 1) {
            const removed = await this.claims.purgeStale();
            total += removed;
            if (removed === 0) break;
          }
          if (total) this.logger.log(`Removed ${total} stale voucher claims.`);
        },
      );
    } catch (error) {
      this.logger.error(
        'Failed to purge stale voucher claims',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}

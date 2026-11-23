import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.module';
import { runWithCronLock } from '@api/infrastructure/redis/cron-lock';

const DAY_MS = 24 * 60 * 60 * 1000;
const GUEST_HISTORY_DAYS = 180;
/** Delete in small batches so a large backlog never holds a long table lock. */
const BATCH_SIZE = 2_000;
const MAX_BATCHES_PER_RUN = 500;

@Injectable()
export class RecentProductViewRetentionCron {
  private readonly logger = new Logger(RecentProductViewRetentionCron.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async removeExpiredRecentHistory(): Promise<void> {
    try {
      await runWithCronLock(
        this.redis,
        'cron:lock:recent-product-view-retention',
        30 * 60_000,
        async () => {
          const guestCutoff = new Date(
            Date.now() - GUEST_HISTORY_DAYS * DAY_MS,
          );
          let total = 0;
          for (let i = 0; i < MAX_BATCHES_PER_RUN; i += 1) {
            const batch = await this.prisma.recentProductView.findMany({
              where: {
                userId: null,
                visitorId: { not: null },
                lastViewedAt: { lt: guestCutoff },
              },
              select: { id: true },
              take: BATCH_SIZE,
            });
            if (batch.length === 0) break;
            const result = await this.prisma.recentProductView.deleteMany({
              where: { id: { in: batch.map(({ id }) => id) } },
            });
            total += result.count;
            if (batch.length < BATCH_SIZE) break;
          }
          if (total) {
            this.logger.log(`Removed ${total} expired recent product views.`);
          }
        },
      );
    } catch (error) {
      this.logger.error(
        'Failed to remove expired recent product views',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}

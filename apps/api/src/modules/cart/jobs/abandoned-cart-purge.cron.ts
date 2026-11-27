import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/cache/redis.module';
import { runWithCronLock } from '@api/infrastructure/cache/cron-lock';

const RETENTION_DAYS = 30;
const BATCH_SIZE = 1_000;
const MAX_BATCHES_PER_RUN = 200;

/**
 * Deletes carts untouched for 30 days. Runs on exactly one replica and deletes
 * in bounded batches so a large backlog cannot lock the carts table.
 */
@Injectable()
export class AbandonedCartPurgeCron {
  private readonly logger = new Logger(AbandonedCartPurgeCron.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeAbandonedCarts(): Promise<void> {
    try {
      await runWithCronLock(
        this.redis,
        'cron:lock:abandoned-cart-purge',
        30 * 60_000,
        async () => {
          const cutoff = new Date(
            Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
          );
          let total = 0;
          for (let i = 0; i < MAX_BATCHES_PER_RUN; i += 1) {
            const batch = await this.prisma.cart.findMany({
              where: { checkedOut: false, updatedAt: { lte: cutoff } },
              select: { id: true },
              take: BATCH_SIZE,
            });
            if (batch.length === 0) break;
            const result = await this.prisma.cart.deleteMany({
              where: { id: { in: batch.map(({ id }) => id) } },
            });
            total += result.count;
            if (batch.length < BATCH_SIZE) break;
          }
          this.logger.log(`Purged ${total} abandoned carts`);
        },
      );
    } catch (error) {
      this.logger.error(
        'Failed to purge abandoned carts',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}

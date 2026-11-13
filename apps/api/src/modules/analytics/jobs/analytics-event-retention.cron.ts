import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { ANALYTICS_EVENT_RETENTION_DAYS } from '@api/common/utils/date-range.util';
import { getErrorMessage } from '@api/common/utils/error-details.util';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOCK_KEY = 'lock:cron:analytics-event-retention';
const LOCK_TTL_SECONDS = 600;
const BATCH_SIZE = 2_000;
const MAX_BATCHES_PER_TABLE = 25;

@Injectable()
export class AnalyticsEventRetentionCron {
  private readonly logger = new Logger(AnalyticsEventRetentionCron.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('0 40 3 * * *', {
    name: 'analytics-event-retention',
    timeZone: 'Africa/Lagos',
  })
  async pruneExpiredEvents(): Promise<void> {
    const token = randomUUID();
    try {
      const acquired = await this.redis.set(
        LOCK_KEY,
        token,
        'EX',
        LOCK_TTL_SECONDS,
        'NX',
      );
      if (!acquired) return;
    } catch (error) {
      this.logger.warn(
        `Analytics event retention skipped because its lock is unavailable: ${getErrorMessage(error)}`,
      );
      return;
    }

    const cutoff = new Date(
      Date.now() - ANALYTICS_EVENT_RETENTION_DAYS * DAY_MS,
    );
    try {
      for (const table of ['product_views', 'marketplace_events'] as const) {
        let deleted = 0;
        let batches = 0;
        let lastBatchCount = 0;

        while (batches < MAX_BATCHES_PER_TABLE) {
          await this.renewLock(token);
          const count = await this.deleteBatch(table, cutoff);
          lastBatchCount = count;
          deleted += count;
          batches += 1;
          if (count < BATCH_SIZE) break;
        }

        if (deleted > 0) {
          this.logger.log(
            `Removed ${deleted} ${table} event(s) older than ${ANALYTICS_EVENT_RETENTION_DAYS} days.`,
          );
        }
        if (
          batches === MAX_BATCHES_PER_TABLE &&
          lastBatchCount === BATCH_SIZE
        ) {
          this.logger.warn(
            `Analytics event retention reached its per-run batch limit for ${table}; remaining rows will be handled by the next scheduled run.`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Analytics event retention failed: ${getErrorMessage(error)}`,
      );
    } finally {
      await this.redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          LOCK_KEY,
          token,
        )
        .catch((error: unknown) => {
          this.logger.warn(
            `Could not release analytics retention lock: ${getErrorMessage(error)}`,
          );
        });
    }
  }

  private async renewLock(token: string): Promise<void> {
    const renewed = await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      LOCK_KEY,
      token,
      LOCK_TTL_SECONDS,
    );
    if (Number(renewed) !== 1) {
      throw new Error('Analytics event retention lock ownership was lost.');
    }
  }

  private deleteBatch(
    table: 'product_views' | 'marketplace_events',
    cutoff: Date,
  ): Promise<number> {
    if (table === 'product_views') {
      return this.prisma.$executeRaw`
        DELETE FROM "product_views" AS event
        USING (
          SELECT id FROM "product_views"
          WHERE "createdAt" < ${cutoff}
          ORDER BY "createdAt" ASC
          LIMIT ${BATCH_SIZE}
        ) AS expired
        WHERE event.id = expired.id
      `;
    }

    return this.prisma.$executeRaw`
      DELETE FROM "marketplace_events" AS event
      USING (
        SELECT id FROM "marketplace_events"
        WHERE "created_at" < ${cutoff}
        ORDER BY "created_at" ASC
        LIMIT ${BATCH_SIZE}
      ) AS expired
      WHERE event.id = expired.id
    `;
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { getErrorMessage } from '@api/common/utils/error-details.util';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';

const RETENTION_DAYS = 180;
const BATCH_SIZE = 2_000;
const LOCK_KEY = 'lock:cron:recommendation-events-retention';
const LOCK_TTL_SECONDS = 300;

@Injectable()
export class RecommendationEventsRetentionCron {
  private readonly logger = new Logger(RecommendationEventsRetentionCron.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async renewLock(lockToken: string): Promise<void> {
    const renewed = await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      LOCK_KEY,
      lockToken,
      LOCK_TTL_SECONDS,
    );
    if (Number(renewed) !== 1) {
      throw new Error(
        'Recommendation event retention lock ownership was lost.',
      );
    }
  }

  @Cron('0 25 3 * * *', {
    name: 'recommendation-events-retention',
    timeZone: 'Africa/Lagos',
  })
  async pruneExpiredEvents(): Promise<void> {
    const lockToken = randomUUID();
    try {
      const acquired = await this.redis.set(
        LOCK_KEY,
        lockToken,
        'EX',
        LOCK_TTL_SECONDS,
        'NX',
      );
      if (!acquired) return;
    } catch (error) {
      this.logger.warn(
        `Could not acquire recommendation retention lock: ${getErrorMessage(error)}`,
      );
      return;
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let deleted = 0;
    try {
      for (;;) {
        await this.renewLock(lockToken);
        const expired = await this.prisma.recommendationEvent.findMany({
          // Follow changes are the durable source for annual follower metrics.
          // Their event volume is low, so retain them beyond recommendation
          // attribution's normal 180-day window.
          where: {
            createdAt: { lt: cutoff },
            eventType: { notIn: ['FOLLOW', 'UNFOLLOW'] },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: BATCH_SIZE,
          select: { id: true },
        });
        if (expired.length === 0) break;

        const result = await this.prisma.recommendationEvent.deleteMany({
          where: { id: { in: expired.map(({ id }) => id) } },
        });
        deleted += result.count;
      }
      if (deleted > 0) {
        this.logger.log(
          `Pruned ${deleted} recommendation event(s) older than ${RETENTION_DAYS} days.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Recommendation event retention failed: ${getErrorMessage(error)}`,
      );
    } finally {
      try {
        await this.redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          LOCK_KEY,
          lockToken,
        );
      } catch (error) {
        this.logger.warn(
          `Could not release recommendation retention lock: ${getErrorMessage(error)}`,
        );
      }
    }
  }
}

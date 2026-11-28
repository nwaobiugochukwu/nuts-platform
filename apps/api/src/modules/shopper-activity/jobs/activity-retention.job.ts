import { ANALYTICS_EVENT_RETENTION_DAYS } from '@api/common/utils/date-range.util';
import { getErrorMessage } from '@api/common/utils/error-details.util';
import { runWithCronLock } from '@api/infrastructure/cache/cron-lock.util';
import { REDIS_CLIENT } from '@api/infrastructure/cache/redis.constants';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Delete in small batches so a large backlog never holds a long table lock. */
export const RETENTION_BATCH_SIZE = 2_000;
/** At most this many batches per table per run; a bigger backlog is finished by the next run. */
export const RETENTION_MAX_BATCHES = 100;

/** How long one kind of shopper-activity data is kept, and how to delete a batch of what has expired. */
export interface RetentionPolicy {
  /** What it is, for the log. */
  name: string;
  retentionDays: number;
  /** Deletes up to `limit` rows older than `cutoff`; returns how many it deleted. */
  deleteBatch(cutoff: Date, limit: number): Promise<number>;
}

/**
 * Removes shopper activity once it is too old, one policy per kind of data, in one nightly run under
 * one lock. Adding a kind of data means adding a policy here, not another job.
 */
@Injectable()
export class ActivityRetentionJob {
  private readonly logger = new Logger(ActivityRetentionJob.name);

  readonly policies: RetentionPolicy[] = [
    {
      name: 'product views',
      retentionDays: ANALYTICS_EVENT_RETENTION_DAYS,
      deleteBatch: (cutoff, limit) => this.prisma.$executeRaw`
        DELETE FROM "product_views" AS row
        USING (
          SELECT id FROM "product_views"
          WHERE "createdAt" < ${cutoff}
          ORDER BY "createdAt" ASC
          LIMIT ${limit}
        ) AS expired
        WHERE row.id = expired.id
      `,
    },
    {
      name: 'shopper activity',
      retentionDays: ANALYTICS_EVENT_RETENTION_DAYS,
      deleteBatch: (cutoff, limit) => this.prisma.$executeRaw`
        DELETE FROM "shopper_activity" AS row
        USING (
          SELECT id FROM "shopper_activity"
          WHERE "created_at" < ${cutoff}
          ORDER BY "created_at" ASC
          LIMIT ${limit}
        ) AS expired
        WHERE row.id = expired.id
      `,
    },
    {
      // Follow changes are the durable source for annual follower metrics. Their volume is low, so
      // they are kept beyond recommendation attribution's normal window.
      name: 'recommendation events',
      retentionDays: 180,
      deleteBatch: async (cutoff, limit) => {
        const expired = await this.prisma.recommendationEvent.findMany({
          where: {
            createdAt: { lt: cutoff },
            eventType: { notIn: ['FOLLOW', 'UNFOLLOW'] },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit,
          select: { id: true },
        });
        if (expired.length === 0) return 0;
        const result = await this.prisma.recommendationEvent.deleteMany({
          where: { id: { in: expired.map(({ id }) => id) } },
        });
        return result.count;
      },
    },
    {
      // A signed-in shopper's recent history is kept; only a guest's (visitor-only) expires.
      name: 'guest recent product views',
      retentionDays: 180,
      deleteBatch: async (cutoff, limit) => {
        const expired = await this.prisma.recentProductView.findMany({
          where: {
            userId: null,
            visitorId: { not: null },
            lastViewedAt: { lt: cutoff },
          },
          select: { id: true },
          take: limit,
        });
        if (expired.length === 0) return 0;
        const result = await this.prisma.recentProductView.deleteMany({
          where: { id: { in: expired.map(({ id }) => id) } },
        });
        return result.count;
      },
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron('0 30 3 * * *', {
    name: 'activity-retention',
    timeZone: 'Africa/Lagos',
  })
  async pruneExpiredActivity(): Promise<void> {
    try {
      await runWithCronLock(
        this.redis,
        'cron:lock:activity-retention',
        45 * 60_000,
        async () => {
          // One policy failing must not stop the others.
          for (const policy of this.policies) {
            try {
              await this.prune(policy);
            } catch (error) {
              this.logger.error(
                `Retention of ${policy.name} failed: ${getErrorMessage(error)}`,
              );
            }
          }
        },
      );
    } catch (error) {
      this.logger.error(`Activity retention failed: ${getErrorMessage(error)}`);
    }
  }

  private async prune(policy: RetentionPolicy): Promise<void> {
    const cutoff = new Date(Date.now() - policy.retentionDays * DAY_MS);
    let deleted = 0;
    let batches = 0;
    let lastBatch = 0;
    while (batches < RETENTION_MAX_BATCHES) {
      lastBatch = await policy.deleteBatch(cutoff, RETENTION_BATCH_SIZE);
      deleted += lastBatch;
      batches += 1;
      if (lastBatch < RETENTION_BATCH_SIZE) break;
    }
    if (deleted > 0) {
      this.logger.log(
        `Removed ${deleted} ${policy.name} older than ${policy.retentionDays} days.`,
      );
    }
    if (
      batches === RETENTION_MAX_BATCHES &&
      lastBatch === RETENTION_BATCH_SIZE
    ) {
      this.logger.warn(
        `Retention of ${policy.name} reached its per-run limit; the rest is left for the next run.`,
      );
    }
  }
}

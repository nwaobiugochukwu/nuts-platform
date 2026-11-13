import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';
import { getErrorMessage } from '@api/common/utils/error-details.util';

@Injectable()
export class NotificationRetentionCron {
  private readonly logger = new Logger(NotificationRetentionCron.name);
  private readonly READ_RETENTION_DAYS = 90;
  private readonly UNREAD_RETENTION_DAYS = 180;
  private readonly BATCH_SIZE = 1000;
  private readonly LOCK_KEY = 'lock:cron:notification-retention';
  private readonly LOCK_TTL_SECONDS = 300;
  private readonly lockToken = randomUUID();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async renewLock(): Promise<void> {
    const renewed = await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      this.LOCK_KEY,
      this.lockToken,
      this.LOCK_TTL_SECONDS,
    );
    if (Number(renewed) !== 1) {
      throw new Error('Notification retention lock ownership was lost.');
    }
  }
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'notification-retention-cleanup',
    timeZone: 'Africa/Lagos',
  })
  async handleRetentionCleanup(): Promise<void> {
    // Acquire distributed lock to ensure only one pod executes the cron
    try {
      const acquired = await this.redis.set(
        this.LOCK_KEY,
        this.lockToken,
        'EX',
        this.LOCK_TTL_SECONDS,
        'NX',
      );
      if (!acquired) {
        this.logger.debug(
          'Notification retention cron skipped: lock held by another cluster instance',
        );
        return;
      }
    } catch (lockErr) {
      this.logger.error(
        `Failed acquiring Redis retention lock: ${getErrorMessage(lockErr)}. Skipping cleanup.`,
      );
      return;
    }

    const startTime = Date.now();
    const now = new Date();
    const readCutoff = new Date(
      now.getTime() - this.READ_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const unreadCutoff = new Date(
      now.getTime() - this.UNREAD_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    let totalDeleted = 0;

    try {
      // 1. Delete read notifications older than 90 days in bounded batches
      let deletedReadInPass = 0;
      do {
        await this.renewLock();
        const expiredRead = await this.prisma.notification.findMany({
          where: {
            isRead: true,
            createdAt: { lt: readCutoff },
          },
          select: { id: true },
          take: this.BATCH_SIZE,
        });

        if (expiredRead.length === 0) break;

        const ids = expiredRead.map((n) => n.id);
        const result = await this.prisma.notification.deleteMany({
          where: { id: { in: ids } },
        });

        deletedReadInPass += result.count;
        totalDeleted += result.count;
      } while (
        deletedReadInPass > 0 &&
        deletedReadInPass % this.BATCH_SIZE === 0
      );

      // 2. Delete unread notifications older than 180 days in bounded batches
      let deletedUnreadInPass = 0;
      do {
        await this.renewLock();
        const expiredUnread = await this.prisma.notification.findMany({
          where: {
            isRead: false,
            createdAt: { lt: unreadCutoff },
          },
          select: { id: true },
          take: this.BATCH_SIZE,
        });

        if (expiredUnread.length === 0) break;

        const ids = expiredUnread.map((n) => n.id);
        const result = await this.prisma.notification.deleteMany({
          where: { id: { in: ids } },
        });

        deletedUnreadInPass += result.count;
        totalDeleted += result.count;
      } while (
        deletedUnreadInPass > 0 &&
        deletedUnreadInPass % this.BATCH_SIZE === 0
      );

      const durationMs = Date.now() - startTime;
      this.logger.log(
        `Notification retention cleanup complete: deleted ${totalDeleted} stale notification(s) (${deletedReadInPass} read, ${deletedUnreadInPass} unread) in ${durationMs}ms`,
      );
    } catch (err) {
      this.logger.error(
        `Error during notification retention cleanup: ${getErrorMessage(err)}`,
      );
    } finally {
      try {
        await this.redis.eval(
          `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
          1,
          this.LOCK_KEY,
          this.lockToken,
        );
      } catch {
        // Ignore
      }
    }
  }
}

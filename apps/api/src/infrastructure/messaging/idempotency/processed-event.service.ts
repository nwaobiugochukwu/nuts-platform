import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/cache/redis.constants';
import { runWithCronLock } from '@api/infrastructure/cache/cron-lock.util';
import { recordConsumerOutcome } from '../rabbitmq/consumer-outcome.util';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';

const PROCESSING = 'PROCESSING';
const DONE = 'DONE';
/** A claim older than this is assumed to belong to a crashed delivery and may be taken over. */
const CLAIM_LEASE_MS = 5 * 60_000;
const RETENTION_DAYS = 14;

/**
 * Makes a queue consumer safe against redelivery. Delivery is at least once: a crash, a deploy,
 * a retry or an outbox replay can hand a consumer the same message again. `runOnce` records
 * (consumer, message id) before the work and marks it done after, so a second delivery of a
 * message that already finished is skipped, and one that is still being handled is left to the
 * delivery that holds the claim.
 *
 * If the work fails, the claim is released so the retry can run. A crash between finishing the
 * work and marking it done leaves a claim that expires after five minutes, after which the work
 * may run once more; that narrow window is the price of not holding a database transaction open
 * around an external call such as sending an email.
 */
@Injectable()
export class ProcessedEventService {
  private readonly logger = new Logger(ProcessedEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  /** Runs `work` unless this consumer has already handled `messageId`. */
  async runOnce(
    consumer: string,
    messageId: string | undefined,
    work: () => Promise<void>,
  ): Promise<'ran' | 'duplicate'> {
    // Messages published before ids existed cannot be de-duplicated; handle them as before.
    if (!messageId) {
      await work();
      return 'ran';
    }

    if (!(await this.claim(consumer, messageId))) {
      this.logger.warn(
        `Skipping ${consumer} message ${messageId}: already handled or being handled.`,
      );
      recordConsumerOutcome(consumer, 'duplicate-skipped');
      return 'duplicate';
    }

    try {
      await work();
    } catch (error) {
      await this.prisma.processedEvent
        .deleteMany({ where: { consumer, messageId, status: PROCESSING } })
        .catch(() => undefined);
      throw error;
    }
    await this.prisma.processedEvent
      .updateMany({
        where: { consumer, messageId },
        data: { status: DONE, completedAt: new Date() },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Could not mark ${consumer} message ${messageId} done: ${String(error)}`,
        );
      });
    return 'ran';
  }

  private async claim(consumer: string, messageId: string): Promise<boolean> {
    const created = await this.prisma.processedEvent.createMany({
      data: [{ consumer, messageId, status: PROCESSING }],
      skipDuplicates: true,
    });
    if (created.count === 1) return true;

    // Someone has a row. Take it over only if its delivery looks crashed.
    const takenOver = await this.prisma.processedEvent.updateMany({
      where: {
        consumer,
        messageId,
        status: PROCESSING,
        claimedAt: { lt: new Date(Date.now() - CLAIM_LEASE_MS) },
      },
      data: { claimedAt: new Date() },
    });
    return takenOver.count === 1;
  }

  /** Forgets records older than the retention window; a message is never redelivered that late. */
  @Cron('0 50 3 * * *', {
    name: 'processed-events-retention',
    timeZone: 'Africa/Lagos',
  })
  async pruneOldRecords(): Promise<void> {
    const run = async () => {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
      const result = await this.prisma.processedEvent.deleteMany({
        where: { status: DONE, completedAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        this.logger.log(
          `Removed ${result.count} processed-event record(s) older than ${RETENTION_DAYS} days.`,
        );
      }
    };
    try {
      if (this.redis) {
        await runWithCronLock(
          this.redis,
          'cron:lock:processed-events-retention',
          10 * 60_000,
          run,
        );
      } else {
        await run();
      }
    } catch (error) {
      this.logger.error(`Processed-event cleanup failed: ${String(error)}`);
    }
  }
}

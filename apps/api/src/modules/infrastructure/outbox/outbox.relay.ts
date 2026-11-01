import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { OutboxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import {
  getErrorCode,
  getErrorMessage,
} from '@api/modules/shared/utils/error-details.util';

@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);
  private isProcessing = false;
  private warnedMissingTable = false;
  private readonly staleClaimMs = 5 * 60 * 1000;
  private claimedIds: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitMQService,
  ) {}

  private hasPendingEvents = true;
  private lastCheckedAt = 0;
  private readonly IDLE_POLL_INTERVAL_MS = 60_000;

  /**
   * Signals the relay that a new outbox event has been persisted.
   * Wakes up the relay immediately without waiting for the interval ticker.
   */
  public notifyNewEvent(): void {
    this.hasPendingEvents = true;
    void this.processOutboxEvents();
  }

  /**
   * Polls the outbox_events table for PENDING events when RabbitMQ is online.
   * Uses adaptive backoff when idle and batches all updates into atomic operations.
   */
  @Interval(10000)
  async processOutboxEvents(): Promise<void> {
    if (this.isProcessing) return;
    if (!this.rabbitmq.isAvailable()) return;

    const now = Date.now();
    // If the outbox is known to be empty, avoid hammering the remote database every 10s
    if (
      !this.hasPendingEvents &&
      now - this.lastCheckedAt < this.IDLE_POLL_INTERVAL_MS
    ) {
      return;
    }
    this.lastCheckedAt = now;
    this.isProcessing = true;

    try {
      const staleBefore = new Date(Date.now() - this.staleClaimMs);
      const pendingEvents = await this.prisma.$transaction(async (tx) => {
        const events = await tx.$queryRaw<
          Array<{
            id: string;
            eventType: string;
            payload: unknown;
            attempts: number;
          }>
        >`
          SELECT id, "eventType", payload, attempts
          FROM "outbox_events"
          WHERE attempts < 5
            AND (
              status IN ('PENDING', 'FAILED')
              OR (status = 'PROCESSING' AND "updatedAt" < ${staleBefore})
            )
          ORDER BY "createdAt" ASC
          LIMIT 50
          FOR UPDATE SKIP LOCKED
        `;
        if (events.length > 0) {
          await tx.outboxEvent.updateMany({
            where: { id: { in: events.map((event) => event.id) } },
            data: { status: OutboxStatus.PROCESSING },
          });
        }
        return events;
      });
      this.claimedIds = pendingEvents.map((event) => event.id);

      if (pendingEvents.length === 0) {
        this.hasPendingEvents = false;
        return;
      }

      // The transaction above atomically claimed these rows under database locks.

      // 2. Publish concurrently to RabbitMQ
      const publishedIds: string[] = [];
      const failedIds: string[] = [];

      await Promise.all(
        pendingEvents.map(async (event) => {
          const success = await this.rabbitmq.publish(
            event.eventType,
            event.payload,
          );
          if (success) {
            publishedIds.push(event.id);
          } else {
            failedIds.push(event.id);
          }
        }),
      );

      // 3. Batch settle successful publishes in a single updateMany
      if (publishedIds.length > 0) {
        await this.prisma.outboxEvent.updateMany({
          where: { id: { in: publishedIds } },
          data: {
            status: OutboxStatus.PUBLISHED,
            processedAt: new Date(),
          },
        });
      }

      // 4. Batch settle failed publishes with attempt increment
      if (failedIds.length > 0) {
        await this.prisma.outboxEvent.updateMany({
          where: { id: { in: failedIds } },
          data: {
            status: OutboxStatus.FAILED,
            attempts: { increment: 1 },
            lastError: 'RabbitMQ publish failed or disconnected',
          },
        });
      }
    } catch (err: unknown) {
      const errorMessage = getErrorMessage(err);
      if (this.claimedIds.length > 0) {
        await this.prisma.outboxEvent
          .updateMany({
            where: {
              id: { in: this.claimedIds },
              status: OutboxStatus.PROCESSING,
            },
            data: {
              status: OutboxStatus.FAILED,
              attempts: { increment: 1 },
              lastError: errorMessage.slice(0, 1000),
            },
          })
          .catch((settleError: unknown) => {
            this.logger.error(
              `Failed settling claimed outbox rows: ${getErrorMessage(settleError)}`,
            );
          });
        this.claimedIds = [];
      }
      if (
        getErrorCode(err) === 'P2021' ||
        (errorMessage.includes('outbox_events') &&
          errorMessage.includes('does not exist'))
      ) {
        if (!this.warnedMissingTable) {
          this.logger.warn(
            'Table public.outbox_events does not exist yet. Relay is idling until migrations or prisma db push are executed.',
          );
          this.warnedMissingTable = true;
        }
        return;
      }
      this.logger.error(`Error in outbox relay execution: ${errorMessage}`);
    } finally {
      this.claimedIds = [];
      this.isProcessing = false;
    }
  }

  @Cron('0 0 3 * * *', {
    name: 'outbox-published-retention-cleanup',
    timeZone: 'Africa/Lagos',
  })
  async prunePublishedEvents(): Promise<void> {
    const retentionCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    try {
      const expiredEvents = await this.prisma.outboxEvent.findMany({
        where: {
          status: OutboxStatus.PUBLISHED,
          processedAt: { lt: retentionCutoff },
        },
        select: { id: true },
        orderBy: { processedAt: 'asc' },
        take: 1000,
      });

      if (expiredEvents.length === 0) return;

      const result = await this.prisma.outboxEvent.deleteMany({
        where: {
          id: { in: expiredEvents.map((event) => event.id) },
          status: OutboxStatus.PUBLISHED,
        },
      });

      this.logger.log(
        `Outbox retention removed ${result.count} published event(s) older than 90 days.`,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Outbox retention cleanup failed: ${getErrorMessage(err)}`,
      );
    }
  }
}

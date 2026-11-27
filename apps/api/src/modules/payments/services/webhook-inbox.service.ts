import { createHash, randomUUID } from 'node:crypto';
import { runWithCronLock } from '@api/infrastructure/cache/cron-lock.util';
import { REDIS_CLIENT } from '@api/infrastructure/cache/redis.constants';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';

const RECEIVED = 'RECEIVED';
const PROCESSED = 'PROCESSED';
const RETENTION_DAYS = 30;

export interface ReceivedWebhook {
  inboxId: string;
  /** True when the provider sent this exact event before; nothing new was queued. */
  duplicate: boolean;
}

/**
 * The webhook inbox: a provider webhook is stored once, exactly as received, and a
 * `payment.webhook_received` event is written to the outbox in the same transaction. The endpoint
 * can then answer the provider at once, and the processing happens from a queue with retries.
 *
 * - **Once:** the key is the sha256 of the raw body, so the provider's own redelivery of an event
 *   is recognised and queues nothing.
 * - **Nothing lost:** the row and the event commit together; if either fails, neither exists and
 *   the provider's retry (which gets an error response) starts again.
 */
@Injectable()
export class WebhookInboxService {
  private readonly logger = new Logger(WebhookInboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRunnerService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  async receive(input: {
    provider: string;
    eventType: string;
    rawBody: string;
  }): Promise<ReceivedWebhook> {
    const eventKey = createHash('sha256').update(input.rawBody).digest('hex');

    return this.transactions.run(
      async (ctx) => {
        const inboxId = randomUUID();
        const created = await ctx.tx.webhookInbox.createMany({
          data: [
            {
              id: inboxId,
              provider: input.provider,
              eventKey,
              eventType: input.eventType,
              payload: input.rawBody,
            },
          ],
          skipDuplicates: true,
        });

        if (created.count !== 1) {
          const existing = await ctx.tx.webhookInbox.findUniqueOrThrow({
            where: {
              provider_eventKey: { provider: input.provider, eventKey },
            },
            select: { id: true },
          });
          return { inboxId: existing.id, duplicate: true };
        }

        await ctx.publish({
          type: DomainEvents.PAYMENT_WEBHOOK_RECEIVED,
          aggregate: { type: 'webhook', id: inboxId },
          payload: {
            inboxId,
            provider: input.provider,
            eventType: input.eventType,
          },
        });
        return { inboxId, duplicate: false };
      },
      { name: 'webhook.receive', preset: 'short' },
    );
  }

  /** The stored webhook, or null if it was cleaned up. */
  load(inboxId: string) {
    return this.prisma.webhookInbox.findUnique({ where: { id: inboxId } });
  }

  async markProcessed(inboxId: string): Promise<void> {
    await this.prisma.webhookInbox.updateMany({
      where: { id: inboxId },
      data: { status: PROCESSED, processedAt: new Date(), lastError: null },
    });
  }

  /** Records a failed attempt (the queue retries it; this is for whoever looks into it). */
  async markAttemptFailed(inboxId: string, error: unknown): Promise<void> {
    await this.prisma.webhookInbox
      .updateMany({
        where: { id: inboxId, status: RECEIVED },
        data: {
          attempts: { increment: 1 },
          lastError: String(
            error instanceof Error ? error.message : error,
          ).slice(0, 1000),
        },
      })
      .catch((e: unknown) => {
        this.logger.warn(`Could not record webhook failure: ${String(e)}`);
      });
  }

  /** Processed webhooks hold customer details; keep them 30 days, for support and replays. */
  @Cron('0 55 3 * * *', {
    name: 'webhook-inbox-retention',
    timeZone: 'Africa/Lagos',
  })
  async pruneProcessed(): Promise<void> {
    const run = async () => {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
      const result = await this.prisma.webhookInbox.deleteMany({
        where: { status: PROCESSED, processedAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        this.logger.log(
          `Removed ${result.count} processed webhook(s) older than ${RETENTION_DAYS} days.`,
        );
      }
    };
    try {
      if (this.redis) {
        await runWithCronLock(
          this.redis,
          'cron:lock:webhook-inbox-retention',
          10 * 60_000,
          run,
        );
      } else {
        await run();
      }
    } catch (error) {
      this.logger.error(`Webhook inbox cleanup failed: ${String(error)}`);
    }
  }
}

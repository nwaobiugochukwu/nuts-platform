import { roleCan } from '@api/config/process-role.config';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import { parseEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { ProcessedEventService } from '@api/infrastructure/messaging/idempotency/processed-event.service';
import { PermanentConsumerError } from '@api/infrastructure/messaging/rabbitmq/consumer-retry.util';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PaymentsService } from '../services/payments.service';
import { WebhookInboxService } from '../services/webhook-inbox.service';
import type { PaystackWebhookEvent } from '../types/paystack.types';

/**
 * Processes stored Paystack webhooks from their own queue. The endpoint has already verified the
 * signature and answered 200; a failure here is retried (10 s, 1 min, 10 min) and then
 * dead-lettered, and processing is idempotent (a redelivered event is skipped; the payment code
 * also guards each state change).
 */
@Injectable()
export class PaymentWebhookConsumer implements OnModuleInit {
  private readonly logger = new Logger(PaymentWebhookConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly inbox: WebhookInboxService,
    private readonly payments: PaymentsService,
    private readonly processed: ProcessedEventService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<unknown>(
      RABBITMQ_QUEUES.PAYMENT_WEBHOOKS,
      async (raw) => {
        const event = parseEnvelope<{ inboxId?: string }>(raw, {
          type: DomainEvents.PAYMENT_WEBHOOK_RECEIVED,
          supportedVersions: [1],
        });
        const inboxId = event.payload.inboxId;
        if (!inboxId) {
          throw new PermanentConsumerError('Webhook event has no inboxId');
        }
        await this.processed.runOnce('payment-webhooks', event.eventId, () =>
          this.process(inboxId),
        );
      },
    );
  }

  private async process(inboxId: string): Promise<void> {
    const stored = await this.inbox.load(inboxId);
    if (!stored) {
      // Cleaned up after retention, or never existed: nothing to do and nothing to retry.
      this.logger.warn(`Webhook ${inboxId} is not in the inbox; skipping.`);
      return;
    }
    if (stored.status === 'PROCESSED') return;

    let event: PaystackWebhookEvent;
    try {
      event = JSON.parse(stored.payload) as PaystackWebhookEvent;
    } catch {
      throw new PermanentConsumerError(`Stored webhook ${inboxId} is not JSON`);
    }

    try {
      await this.payments.processWebhookEvent(event);
    } catch (error) {
      await this.inbox.markAttemptFailed(inboxId, error);
      throw error;
    }
    await this.inbox.markProcessed(inboxId);
  }
}

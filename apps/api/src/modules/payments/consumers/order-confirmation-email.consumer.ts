import { roleCan } from '@api/config/process-role.config';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import { parseEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { ProcessedEventService } from '@api/infrastructure/messaging/idempotency/processed-event.service';
import { PermanentConsumerError } from '@api/infrastructure/messaging/rabbitmq/consumer-retry.util';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PaymentsService } from '../services/payments.service';

/**
 * Sends the order confirmation email, with the PDF invoice attached, when a payment is confirmed.
 * It used to run after the commit with a log-only catch, so a crash or a provider outage lost the
 * email; now it is a retried, dead-lettered, de-duplicated consumer of `payment.confirmed`, which
 * is written to the outbox in the transaction that settles the payment.
 */
@Injectable()
export class OrderConfirmationEmailConsumer implements OnModuleInit {
  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly payments: PaymentsService,
    private readonly processed: ProcessedEventService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<unknown>(
      RABBITMQ_QUEUES.ORDER_CONFIRMATION_EMAILS,
      async (raw) => {
        const event = parseEnvelope<{ paymentId?: string }>(raw, {
          type: DomainEvents.PAYMENT_CONFIRMED,
          supportedVersions: [1],
        });
        const { paymentId } = event.payload;
        if (!paymentId) {
          throw new PermanentConsumerError(
            'payment.confirmed has no paymentId',
          );
        }
        await this.processed.runOnce(
          'order-confirmation-emails',
          event.eventId,
          () => this.payments.sendOrderConfirmationEmail(paymentId),
        );
      },
    );
  }
}

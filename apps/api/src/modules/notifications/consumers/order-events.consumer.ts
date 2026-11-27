import { roleCan } from '@api/config/process-role.config';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import { parseEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import type {
  OrderCancelledPayload,
  OrderDeliveredPayload,
  OrderProcessingPayload,
  OrderShippedPayload,
  PaymentConfirmedPayload,
  PaymentFailedPayload,
  ReferralRewardCreditedPayload,
} from '@api/infrastructure/messaging/events/event-payloads.types';
import { ProcessedEventService } from '@api/infrastructure/messaging/idempotency/processed-event.service';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OrderEventNotificationsService } from '../services/order-event-notifications.service';

const HANDLED_TYPES = [
  DomainEvents.ORDER_PROCESSING,
  DomainEvents.ORDER_SHIPPED,
  DomainEvents.ORDER_DELIVERED,
  DomainEvents.ORDER_CANCELLED,
  DomainEvents.PAYMENT_CONFIRMED,
  DomainEvents.PAYMENT_FAILED,
  DomainEvents.REFERRAL_REWARD_CREDITED,
] as const;

/**
 * Reads order, payment and referral events from its own queue and hands each to the service that
 * sends the emails and notifications. The events are written to the outbox in the same
 * transaction as the change, so a crash cannot lose them; a redelivery is skipped by event id.
 */
@Injectable()
export class OrderEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderEventsConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly notifications: OrderEventNotificationsService,
    private readonly processed: ProcessedEventService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<unknown>(
      RABBITMQ_QUEUES.ORDER_EVENTS,
      async (raw) => {
        const event = parseEnvelope(raw, {
          type: HANDLED_TYPES,
          supportedVersions: [1],
        });
        await this.processed.runOnce('order-events', event.eventId, () =>
          this.dispatch(event.type, event.payload),
        );
      },
    );
  }

  private dispatch(type: string, payload: unknown): Promise<void> {
    switch (type) {
      case DomainEvents.ORDER_PROCESSING:
        return this.notifications.handleOrderProcessing(
          payload as OrderProcessingPayload,
        );
      case DomainEvents.ORDER_SHIPPED:
        return this.notifications.handleOrderShipped(
          payload as OrderShippedPayload,
        );
      case DomainEvents.ORDER_DELIVERED:
        return this.notifications.handleOrderDelivered(
          payload as OrderDeliveredPayload,
        );
      case DomainEvents.ORDER_CANCELLED:
        return this.notifications.handleOrderCancelled(
          payload as OrderCancelledPayload,
        );
      case DomainEvents.PAYMENT_CONFIRMED:
        return this.notifications.handlePaymentConfirmed(
          payload as PaymentConfirmedPayload,
        );
      case DomainEvents.PAYMENT_FAILED:
        return this.notifications.handlePaymentFailed(
          payload as PaymentFailedPayload,
        );
      case DomainEvents.REFERRAL_REWARD_CREDITED:
        return this.notifications.handleReferralReward(
          payload as ReferralRewardCreditedPayload,
        );
      default:
        // parseEnvelope already limits the types; this guards a future addition to the list.
        this.logger.error(`No handler for ${type}`);
        return Promise.reject(new Error(`No handler for ${type}`));
    }
  }
}

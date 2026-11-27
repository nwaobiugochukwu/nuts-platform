import { roleCan } from '@api/config/process-role.config';
import { DomainEvents } from '@api/infrastructure/messaging/events/domain-events.constants';
import { parseEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { PermanentConsumerError } from '@api/infrastructure/messaging/rabbitmq/consumer-retry.util';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ReviewAggregateService } from '../services/review-aggregate.service';

const HANDLED_TYPES = [
  DomainEvents.REVIEW_CREATED,
  DomainEvents.REVIEW_UPDATED,
  DomainEvents.REVIEW_DELETED,
] as const;

/**
 * Refreshes a product's stored rating summary whenever a review is created, changed or removed.
 * It recomputes from the reviews instead of adding to a counter, so it needs no de-duplication and
 * no ordering: any event for the product, in any order, any number of times, leaves the right
 * numbers.
 */
@Injectable()
export class ReviewAggregateConsumer implements OnModuleInit {
  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly aggregate: ReviewAggregateService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<unknown>(
      RABBITMQ_QUEUES.REVIEW_AGGREGATES,
      async (raw) => {
        const event = parseEnvelope<{ productId?: string }>(raw, {
          type: HANDLED_TYPES,
          supportedVersions: [1],
        });
        const { productId } = event.payload;
        if (!productId) {
          throw new PermanentConsumerError(`${event.type} has no productId`);
        }
        await this.aggregate.recompute(productId);
      },
    );
  }
}

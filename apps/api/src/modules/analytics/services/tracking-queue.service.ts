import { RABBITMQ_ROUTING_KEYS } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { Injectable, Optional } from '@nestjs/common';

/**
 * Hands tracking events (recommendation clicks, store views, cart and wishlist actions, searches)
 * to the analytics queue instead of writing them to Postgres inside the request.
 *
 * Tracking is behaviour data, not money: if the broker is unreachable this returns false and the
 * caller falls back to writing the rows itself, as it always did, so nothing is lost and the
 * request path never depends on RabbitMQ being up.
 */
@Injectable()
export class TrackingQueueService {
  constructor(@Optional() private readonly rabbitmq?: RabbitMQService) {}

  /** True when the broker confirmed the message. */
  async enqueue(payload: Record<string, unknown>): Promise<boolean> {
    if (!this.rabbitmq?.isAvailable()) return false;
    return this.rabbitmq.publish(
      RABBITMQ_ROUTING_KEYS.ANALYTICS_EVENT,
      payload,
    );
  }
}

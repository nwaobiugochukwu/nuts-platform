import { currentRequestId } from '@api/common/request-context/request-context.util';
import { buildEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  ShopperActivity,
  ShopperActivityBody,
} from '../types/shopper-activity.types';
import {
  eventNameFor,
  shopperAggregate,
} from '../utils/shopper-activity.mapper';

/**
 * The one way shopper activity goes to the analytics queue instead of being written to Postgres
 * inside the request. Each activity goes out as `shopper.<action>` in the standard envelope
 * (ADR 0007), about the shopper who did it.
 *
 * Shopper activity is behaviour data, not money: if the broker is unreachable `record` returns
 * false and the recorder stores the activity itself, so nothing is lost and a request never depends on
 * RabbitMQ being up. (Money and state changes use the transactional outbox instead, which cannot
 * lose an event; this path trades that guarantee for not needing a database write per click.)
 */
@Injectable()
export class ShopperActivityPublisherService {
  constructor(@Optional() private readonly rabbitmq?: RabbitMQService) {}

  /** True when the broker confirmed it. `occurredAt` is for activity that happened earlier than now. */
  async record(
    activity: ShopperActivity,
    options: { occurredAt?: Date } = {},
  ): Promise<boolean> {
    if (!this.rabbitmq?.isAvailable()) return false;
    const { action, ...body } = activity;
    const eventId = randomUUID();
    const envelope = buildEnvelope(
      {
        type: eventNameFor(action),
        aggregate: shopperAggregate(activity, activity.id),
        ...(activity.userId
          ? { actor: { type: 'user' as const, id: activity.userId } }
          : {}),
        ...(options.occurredAt ? { occurredAt: options.occurredAt } : {}),
        payload: body satisfies ShopperActivityBody,
      },
      { eventId, requestId: currentRequestId() },
    );
    return this.rabbitmq.publish(eventNameFor(action), envelope, {
      messageId: eventId,
    });
  }
}

import {
  getErrorMessage,
  getErrorStack,
} from '@api/common/utils/error-details.util';
import { roleCan } from '@api/config/process-role.config';
import { parseEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { PermanentConsumerError } from '@api/infrastructure/messaging/rabbitmq/consumer-retry.util';
import { RABBITMQ_QUEUES } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/messaging/rabbitmq/rabbitmq.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ShopperActivityStoreService } from '../services/shopper-activity-store.service';
import type {
  ShopperAction,
  ShopperActivity,
  ShopperActivityBody,
} from '../types/shopper-activity.types';
import {
  SHOPPER_ACTIVITY_EVENTS,
  actionForEvent,
  missingFields,
} from '../utils/shopper-activity.mapper';

/**
 * Takes shopper activity (a product viewed, a search, a store viewed, a cart or wishlist change, a
 * shelf item seen or clicked) off its queue and stores it. Every event it handles is
 * `shopper.<action>`, and every one is the same thing: a `ShopperActivity`.
 *
 * A message that cannot be understood (not an envelope, an unknown event, a missing field) is
 * dead-lettered at once. A failure to store is thrown, so the queue retries it and then
 * dead-letters it; acknowledging a failed insert would silently erase behaviour data. How rows are
 * written, and what happens to a row that points at something deleted, is the store's concern.
 */
@Injectable()
export class ShopperActivityConsumer implements OnModuleInit {
  private readonly logger = new Logger(ShopperActivityConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly store: ShopperActivityStoreService,
  ) {}

  async onModuleInit() {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<unknown>(RABBITMQ_QUEUES.ANALYTICS, (raw) =>
      this.handle(raw),
    );
  }

  private async handle(raw: unknown): Promise<void> {
    const event = parseEnvelope(raw, {
      type: SHOPPER_ACTIVITY_EVENTS,
      supportedVersions: [1],
    });
    // parseEnvelope only lets the shopper-activity events through, so there is always an action.
    const action = actionForEvent(event.type) as ShopperAction;
    const activity = {
      ...(event.payload as unknown as ShopperActivityBody),
      action,
    } satisfies ShopperActivity;
    const missing = missingFields(activity);
    if (missing.length > 0) {
      throw new PermanentConsumerError(
        `${event.type} is missing ${missing.join(', ')}`,
      );
    }
    try {
      await this.store.save(activity, new Date(event.occurredAt));
    } catch (err: unknown) {
      this.logger.error(
        `Failed to process ${event.type}: ${getErrorMessage(err)}`,
        getErrorStack(err),
      );
      throw err;
    }
  }
}

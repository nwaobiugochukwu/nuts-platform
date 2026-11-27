import {
  getErrorMessage,
  getErrorStack,
} from '@api/common/utils/error-details.util';
import { roleCan } from '@api/config/process-role.config';
import { PermanentConsumerError } from '@api/infrastructure/messaging/rabbitmq/consumer-retry.util';
import { parseEnvelope } from '@api/infrastructure/messaging/events/event-envelope.util';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { RABBITMQ_QUEUES } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.service';
import { RecommendationRefreshService } from '../services/recommendation-refresh.service';
import type {
  ShopperActivity,
  ShopperActivityBody,
} from '../types/shopper-activity.types';
import { adaptLegacyTrackingMessage } from '../utils/legacy-tracking-message.util';
import {
  SHOPPER_ACTIVITY_EVENTS,
  actionForEvent,
  feedRefreshFor,
  missingFields,
  storeFor,
  toActivityRow,
  toProductViewRow,
  toSearchRow,
  toShelfRow,
} from '../utils/shopper-activity.mapper';

/**
 * Stores shopper activity (a product viewed, a search, a store viewed, a cart or wishlist change, a
 * shelf item seen or clicked) from its queue. Every event it handles is `shopper.<action>`, and
 * every one is the same thing: a `ShopperActivity`.
 *
 * Every activity carries the id of the row it becomes and rows are inserted with `skipDuplicates`,
 * so a redelivery is a no-op. A row that points at something deleted since (a removed user or
 * product) is dropped, or kept as an anonymous visitor for product views, rather than retried
 * forever. Anything else that goes wrong is thrown, so the queue retries it and then dead-letters
 * it; acknowledging a failed insert would silently erase behaviour data.
 */
@Injectable()
export class AnalyticsConsumer implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly refresh: RecommendationRefreshService,
  ) {}

  async onModuleInit() {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<unknown>(
      RABBITMQ_QUEUES.ANALYTICS,
      async (raw) => {
        // Messages from the previous release use another shape; see the adapter. An old batch
        // becomes several events, handled one after the other (a redelivery repeats only no-ops).
        const legacy = adaptLegacyTrackingMessage(raw);
        if (legacy === 'ignore') return;
        for (const event of legacy ?? [raw]) await this.handle(event);
      },
    );
  }

  private async handle(raw: unknown): Promise<void> {
    const event = parseEnvelope(raw, {
      type: SHOPPER_ACTIVITY_EVENTS,
      supportedVersions: [1],
    });
    const action = actionForEvent(event.type);
    if (!action) {
      throw new PermanentConsumerError(`No handler for ${event.type}`);
    }
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
      await this.store(activity, new Date(event.occurredAt));
    } catch (err: unknown) {
      this.logger.error(
        `Failed to process ${event.type}: ${getErrorMessage(err)}`,
        getErrorStack(err),
      );
      throw err;
    }
    this.refreshFeed(activity);
  }

  /** One row, in the table that holds that kind of activity. */
  private async store(activity: ShopperActivity, at: Date): Promise<void> {
    switch (storeFor(activity.action)) {
      case 'product_views':
        return this.storeProductView(activity, at);
      case 'searches':
        return this.storeRows(() =>
          this.prisma.searchQuery.createMany({
            data: [toSearchRow(activity, at)],
            skipDuplicates: true,
          }),
        );
      case 'shelf':
        return this.storeRows(() =>
          this.prisma.recommendationEvent.createMany({
            data: [toShelfRow(activity, at)],
            skipDuplicates: true,
          }),
        );
      case 'activity':
        return this.storeRows(() =>
          this.prisma.marketplaceEvent.createMany({
            data: [toActivityRow(activity, at)],
            skipDuplicates: true,
          }),
        );
    }
  }

  private async storeProductView(
    activity: ShopperActivity,
    at: Date,
  ): Promise<void> {
    try {
      await this.prisma.productView.createMany({
        data: [toProductViewRow(activity, at)],
        skipDuplicates: true,
      });
    } catch (error) {
      if (!isMissingReference(error)) throw error;
      // The user is not in the users table (a vendor browsing as a visitor): keep the view as an
      // anonymous visitor instead of losing it.
      await this.prisma.productView.createMany({
        data: [
          {
            ...toProductViewRow(activity, at),
            userId: null,
            visitorId:
              activity.visitorId ??
              (activity.userId ? `visitor:${activity.userId}` : null),
          },
        ],
        skipDuplicates: true,
      });
    }
  }

  /** Once the row exists, clear the shopper's cached shelves (once per burst) and rebuild the feed. */
  private refreshFeed(activity: ShopperActivity): void {
    const target = feedRefreshFor(activity);
    if (target) this.refresh.schedule(target.keys, target.actor);
  }

  /**
   * Stores rows, treating a reference to something that no longer exists (a deleted user or
   * product, P2003) as nothing to store: tracking must never poison the queue.
   */
  private async storeRows(write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (error) {
      if (isMissingReference(error)) {
        this.logger.warn('Skipped tracking rows that reference a missing row.');
        return;
      }
      throw error;
    }
  }
}

function isMissingReference(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}

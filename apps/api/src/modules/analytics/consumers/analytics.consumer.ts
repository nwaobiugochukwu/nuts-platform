import { roleCan } from '@api/config/process-role.config';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { productViewEventId } from '@api/common/utils/product-view-event-id.util';
import { RecommendationRefreshService } from '../services/recommendation-refresh.service';
import { RABBITMQ_QUEUES } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.service';
import {
  getErrorMessage,
  getErrorStack,
} from '@api/common/utils/error-details.util';

/** The rows as they are stored; the producers validate them before they are queued. */
export type TrackedRecommendationEvent =
  Prisma.RecommendationEventCreateManyInput;
export type TrackedMarketplaceEvent = Prisma.MarketplaceEventCreateManyInput;

export interface AnalyticsQueuePayload {
  type:
    | 'product_view'
    | 'search'
    | 'recommendation_events'
    | 'marketplace_event';
  /** Recommendation batches: the rows to store. */
  events?: TrackedRecommendationEvent[];
  /** Marketplace events: the row to store. */
  event?: TrackedMarketplaceEvent;
  /** Shopper ids whose cached recommendations should be refreshed once the rows are stored. */
  refreshFor?: Array<string | null | undefined>;
  id?: string;
  productId?: string;
  userId?: string | null;
  visitorId?: string | null;
  sessionId?: string | null;
  query?: string;
  resultsCount?: number;
  timestamp?: string | number | Date;
}

@Injectable()
export class AnalyticsConsumer implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly refresh: RecommendationRefreshService,
  ) {}

  /**
   * Stores rows, treating a reference to something that no longer exists (a deleted user or
   * product, P2003) as nothing to store: tracking must never poison the queue.
   */
  private async storeRows(write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        this.logger.warn('Skipped tracking rows that reference a missing row.');
        return;
      }
      throw error;
    }
  }

  private async storeRecommendationEvents(
    events: TrackedRecommendationEvent[],
  ): Promise<void> {
    try {
      await this.prisma.recommendationEvent.createMany({
        data: events,
        skipDuplicates: true,
      });
    } catch (error) {
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        )
      ) {
        throw error;
      }
      // One event in the batch points at a row that is gone: keep the others.
      for (const event of events) {
        await this.storeRows(() =>
          this.prisma.recommendationEvent.createMany({
            data: [event],
            skipDuplicates: true,
          }),
        );
      }
    }
  }

  async onModuleInit() {
    // Queue consumers run only in the worker role (or when one process runs everything).
    if (!roleCan('consumers')) return;
    await this.rabbitmq.consume<AnalyticsQueuePayload>(
      RABBITMQ_QUEUES.ANALYTICS,
      async (payload) => {
        try {
          if (!payload) return;

          const createdAt = payload.timestamp
            ? new Date(payload.timestamp)
            : new Date();

          if (payload.type === 'product_view' && payload.productId) {
            try {
              await this.prisma.productView.createMany({
                data: [
                  {
                    id:
                      payload.id ??
                      productViewEventId({
                        productId: payload.productId,
                        userId: payload.userId,
                        visitorId: payload.visitorId,
                        sessionId: payload.sessionId,
                        timestamp: payload.timestamp,
                      }),
                    productId: payload.productId,
                    userId: payload.userId ?? null,
                    visitorId: payload.visitorId ?? null,
                    sessionId: payload.sessionId ?? null,
                    createdAt,
                  },
                ],
                // RabbitMQ may redeliver after the insert succeeded but before
                // the delivery acknowledgement was recorded.
                skipDuplicates: true,
              });
            } catch (insertErr) {
              if (
                insertErr instanceof Prisma.PrismaClientKnownRequestError &&
                insertErr.code === 'P2003'
              ) {
                // If userId does not exist in User table (e.g. vendor browsing as visitor), fallback with visitorId
                await this.prisma.productView.createMany({
                  data: [
                    {
                      id:
                        payload.id ??
                        productViewEventId({
                          productId: payload.productId,
                          userId: undefined,
                          visitorId:
                            payload.visitorId ??
                            (payload.userId
                              ? `visitor:${payload.userId}`
                              : null),
                          sessionId: payload.sessionId,
                          timestamp: payload.timestamp,
                        }),
                      productId: payload.productId,
                      userId: null,
                      visitorId:
                        payload.visitorId ??
                        (payload.userId ? `visitor:${payload.userId}` : null),
                      sessionId: payload.sessionId ?? null,
                      createdAt,
                    },
                  ],
                  skipDuplicates: true,
                });
              } else {
                throw insertErr;
              }
            }
          } else if (payload.type === 'search' && payload.query) {
            await this.storeRows(() =>
              this.prisma.searchQuery.createMany({
                data: [
                  {
                    // A producer-assigned id makes a redelivery a no-op.
                    ...(payload.id ? { id: payload.id } : {}),
                    query: payload.query as string,
                    resultsCount: payload.resultsCount ?? 0,
                    userId: payload.userId ?? null,
                    sessionId: payload.sessionId ?? null,
                    createdAt,
                  },
                ],
                skipDuplicates: true,
              }),
            );
            this.refresh.schedule(...(payload.refreshFor ?? []));
          } else if (
            payload.type === 'recommendation_events' &&
            payload.events?.length
          ) {
            await this.storeRecommendationEvents(payload.events);
            this.refresh.schedule(...(payload.refreshFor ?? []));
          } else if (payload.type === 'marketplace_event' && payload.event) {
            const event = payload.event;
            await this.storeRows(() =>
              this.prisma.marketplaceEvent.createMany({
                data: [{ ...event, createdAt: event.createdAt ?? createdAt }],
                skipDuplicates: true,
              }),
            );
          }
        } catch (err: unknown) {
          this.logger.error(
            `Failed to process analytics event: ${getErrorMessage(err)}`,
            getErrorStack(err),
          );
          // Let the queue wrapper reject the delivery into its dead-letter path;
          // acknowledging a failed insert would silently erase behavior data.
          throw err;
        }
      },
    );
  }
}

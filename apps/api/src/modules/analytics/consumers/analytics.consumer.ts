import { roleCan } from '@api/config/process-role';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { productViewEventId } from '@api/common/utils/product-view-event-id.util';
import { RABBITMQ_QUEUES } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.service';
import {
  getErrorMessage,
  getErrorStack,
} from '@api/common/utils/error-details.util';

export interface AnalyticsQueuePayload {
  type: 'product_view' | 'search';
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
  ) {}

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
            await this.prisma.searchQuery.create({
              data: {
                query: payload.query,
                resultsCount: payload.resultsCount ?? 0,
                userId: payload.userId ?? null,
                sessionId: payload.sessionId ?? null,
                createdAt,
              },
            });
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

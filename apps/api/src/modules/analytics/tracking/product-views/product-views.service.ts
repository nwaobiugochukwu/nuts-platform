import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RABBITMQ_ROUTING_KEYS } from '@api/infrastructure/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/rabbitmq/rabbitmq.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { TRACKING } from '@api/common/constants';
import { productViewEventId } from '@api/common/utils/product-view-event-id.util';

interface BufferedView {
  id?: string;
  productId: string;
  userId?: string;
  visitorId?: string;
  sessionId?: string;
  timestamp: string;
}

@Injectable()
export class ProductViewsService {
  private readonly logger = new Logger(ProductViewsService.name);
  private readonly viewBufferKey = 'tracking:product_views:buffer';
  private readonly viewProcessingKey = 'tracking:product_views:processing';
  private readonly flushLockKey = 'tracking:product_views:flush_lock';
  private readonly flushLockTtlSeconds = 300;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly rabbitmq: RabbitMQService,
    private readonly prisma: PrismaService,
  ) {
    this.startFlushTimer();
  }

  /**
   * Track a product view â€” buffers in Redis, flushes to queue periodically.
   */
  async trackView(
    productId: string,
    userId?: string,
    sessionId?: string,
    visitorId?: string,
    eventId?: string,
  ): Promise<void> {
    const resolvedEventId = eventId ?? randomUUID();
    const resolvedSessionId = sessionId || randomUUID();
    const timestamp = new Date();
    await this.upsertRecentProductView(
      productId,
      userId,
      visitorId || resolvedSessionId,
      timestamp,
    );
    if (!this.redis || this.redis.status !== 'ready') {
      // Keep recommendation signals usable during a Redis outage instead of
      // acknowledging a view that was never stored.
      await this.prisma.productView.createMany({
        data: [
          {
            id: resolvedEventId,
            productId,
            userId: userId ?? null,
            visitorId: visitorId ?? null,
            sessionId: resolvedSessionId,
            createdAt: timestamp,
          },
        ],
        skipDuplicates: true,
      });
      return;
    }

    const view: BufferedView = {
      id: resolvedEventId,
      productId,
      userId,
      visitorId,
      sessionId: resolvedSessionId,
      timestamp: timestamp.toISOString(),
    };

    try {
      // Retries may append the same event more than once. The event ID is the
      // durable idempotency key in ProductView, so Redis does not need a second
      // dedupe record that could outlive a lost buffer entry.
      await this.redis.rpush(this.viewBufferKey, JSON.stringify(view));
    } catch (err) {
      this.logger.warn(
        `Failed to buffer product view: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.prisma.productView.createMany({
        data: [
          {
            id: resolvedEventId,
            productId,
            userId: userId ?? null,
            visitorId: visitorId ?? null,
            sessionId: resolvedSessionId,
            createdAt: timestamp,
          },
        ],
        skipDuplicates: true,
      });
    }
  }

  private upsertRecentProductView(
    productId: string,
    userId: string | undefined,
    visitorId: string,
    lastViewedAt: Date,
  ) {
    if (userId) {
      return this.prisma.recentProductView.upsert({
        where: { userId_productId: { userId, productId } },
        create: { userId, productId, lastViewedAt },
        update: { lastViewedAt },
      });
    }

    return this.prisma.recentProductView.upsert({
      where: { visitorId_productId: { visitorId, productId } },
      create: { visitorId, productId, lastViewedAt },
      update: { lastViewedAt },
    });
  }

  /**
   * Flush buffered views to the analytics queue for DB insertion.
   */
  async flushViews(): Promise<void> {
    if (!this.redis || this.redis.status !== 'ready') {
      return;
    }

    const lockToken = randomUUID();
    let lockAcquired = false;

    try {
      lockAcquired = Boolean(
        await this.redis.set(
          this.flushLockKey,
          lockToken,
          'EX',
          this.flushLockTtlSeconds,
          'NX',
        ),
      );
      if (!lockAcquired) return;

      // Restore rows left in the processing list by a previous crashed flush.
      await this.redis.eval(
        `
          local items = redis.call('LRANGE', KEYS[2], 0, -1)
          for i = #items, 1, -1 do
            redis.call('LPUSH', KEYS[1], items[i])
          end
          redis.call('DEL', KEYS[2])
          return #items
        `,
        2,
        this.viewBufferKey,
        this.viewProcessingKey,
      );

      const batchSize = TRACKING.PRODUCT_VIEW_BATCH_SIZE;
      const maxBatchesPerFlush = 10;
      let processed = 0;

      for (
        let batchNumber = 0;
        batchNumber < maxBatchesPerFlush;
        batchNumber++
      ) {
        const renewed = await this.redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
          1,
          this.flushLockKey,
          lockToken,
          this.flushLockTtlSeconds,
        );
        if (Number(renewed) !== 1) {
          throw new Error('Product-view flush lock ownership was lost.');
        }

        const raw = (await this.redis.eval(
          `
            local items = {}
            for i = 1, tonumber(ARGV[1]) do
              local item = redis.call('LPOP', KEYS[1])
              if not item then break end
              redis.call('RPUSH', KEYS[2], item)
              table.insert(items, item)
            end
            return items
          `,
          2,
          this.viewBufferKey,
          this.viewProcessingKey,
          batchSize,
        )) as string[];
        if (raw.length === 0) break;

        const directPersistViews: Array<{ raw: string; view: BufferedView }> =
          [];
        for (const item of raw) {
          let view: BufferedView;
          try {
            view = JSON.parse(item) as BufferedView;
          } catch {
            await this.redis.lrem(this.viewProcessingKey, 1, item);
            continue;
          }
          view.id ??= productViewEventId(view);

          const published = await this.rabbitmq.publish(
            RABBITMQ_ROUTING_KEYS.ANALYTICS_EVENT,
            {
              type: 'product_view',
              id: view.id,
              productId: view.productId,
              userId: view.userId,
              visitorId: view.visitorId,
              sessionId: view.sessionId,
              timestamp: view.timestamp,
            },
          );
          if (published) {
            await this.redis.lrem(this.viewProcessingKey, 1, item);
            processed++;
          } else {
            directPersistViews.push({ raw: item, view });
          }
        }

        if (directPersistViews.length > 0) {
          await this.prisma.productView.createMany({
            data: directPersistViews.map(({ view }) => ({
              id: view.id ?? productViewEventId(view),
              productId: view.productId,
              userId: view.userId ?? null,
              visitorId: view.visitorId ?? null,
              sessionId: view.sessionId ?? null,
              createdAt: new Date(view.timestamp),
            })),
            skipDuplicates: true,
          });
          for (const { raw: item } of directPersistViews) {
            await this.redis.lrem(this.viewProcessingKey, 1, item);
          }
          processed += directPersistViews.length;
        }
      }

      if (processed > 0) {
        this.logger.debug(
          { count: processed },
          'Flushed product views to queue',
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to flush product views: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      if (lockAcquired) {
        await this.redis
          .eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            this.flushLockKey,
            lockToken,
          )
          .catch((err: unknown) => {
            this.logger.warn(
              `Failed to release product-view flush lock: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }
    }
  }

  private startFlushTimer(): void {
    const interval = TRACKING.PRODUCT_VIEW_FLUSH_INTERVAL_MS;
    this.flushTimer = setInterval(() => {
      void this.flushViews().catch((err) => {
        this.logger.warn(
          `Failed to flush product views interval: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, interval);

    // Prevent timer from keeping process alive
    if (this.flushTimer && typeof this.flushTimer === 'object') {
      this.flushTimer.unref();
    }
  }

  /**
   * Call on module destroy to flush remaining views.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      await this.flushViews();
    } catch {
      // Ignore during shutdown
    }
  }
}

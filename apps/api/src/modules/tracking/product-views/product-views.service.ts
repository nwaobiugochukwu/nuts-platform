import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RABBITMQ_QUEUES } from '@api/modules/infrastructure/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/modules/infrastructure/rabbitmq/rabbitmq.service';
import { TRACKING } from '@api/modules/shared/constants';

interface BufferedView {
  productId: string;
  userId?: string;
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
  ) {
    this.startFlushTimer();
  }

  /**
   * Track a product view — buffers in Redis, flushes to queue periodically.
   */
  async trackView(
    productId: string,
    userId?: string,
    sessionId?: string,
  ): Promise<void> {
    if (!this.redis || this.redis.status !== 'ready') {
      return;
    }

    const view: BufferedView = {
      productId,
      userId,
      sessionId: sessionId || randomUUID(),
      timestamp: new Date().toISOString(),
    };

    try {
      await this.redis.rpush(this.viewBufferKey, JSON.stringify(view));
    } catch (err) {
      this.logger.warn(
        `Failed to buffer product view: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

        for (const item of raw) {
          let view: BufferedView;
          try {
            view = JSON.parse(item) as BufferedView;
          } catch {
            await this.redis.lrem(this.viewProcessingKey, 1, item);
            continue;
          }

          await this.rabbitmq.publish(RABBITMQ_QUEUES.ANALYTICS, {
            type: 'product_view',
            productId: view.productId,
            userId: view.userId,
            sessionId: view.sessionId,
            timestamp: view.timestamp,
          });
          await this.redis.lrem(this.viewProcessingKey, 1, item);
          processed++;
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

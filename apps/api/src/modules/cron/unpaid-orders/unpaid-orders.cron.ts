import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '@api/modules/infrastructure/redis/redis.constants';
import { OrdersService } from '@api/modules/checkout/orders/orders.service';
import { UNPAID_ORDER_EXPIRATION } from '@api/modules/shared/constants';

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

@Injectable()
export class UnpaidOrdersCron {
  private readonly logger = new Logger(UnpaidOrdersCron.name);
  private readonly lockKey = 'cron:lock:unpaid-orders';

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron(UNPAID_ORDER_EXPIRATION.CRON_SCHEDULE, {
    name: 'unpaid-orders-expiration',
    timeZone: 'Africa/Lagos',
  })
  async handleExpiredUnpaidOrders(): Promise<void> {
    const startedAt = Date.now();
    const now = new Date();
    const lockToken = randomUUID();

    // Distributed lock with unique token prevents concurrent cron execution
    // and ensures instances only delete their own lock upon completion.
    const lockAcquired = await this.redis.set(
      this.lockKey,
      lockToken,
      'PX',
      UNPAID_ORDER_EXPIRATION.LOCK_TTL_MS,
      'NX',
    );

    if (!lockAcquired) {
      this.logger.debug(
        'Unpaid orders sweep skipped: another cluster instance holds the active lock.',
      );
      return;
    }

    try {
      const expirationCutoff = new Date(
        now.getTime() - UNPAID_ORDER_EXPIRATION.PENDING_TTL_MINUTES * 60 * 1000,
      );
      // Safety boundary: do not touch ancient orders (e.g. older than 7 days)
      const maxAgeCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Find pending orders exceeding the checkout TTL with no successful payment
      const expiredOrders = await this.prisma.order.findMany({
        where: {
          status: OrderStatus.PENDING,
          createdAt: {
            lte: expirationCutoff,
            gte: maxAgeCutoff,
          },
          OR: [
            { payment: null },
            {
              payment: {
                is: {
                  status: {
                    in: [PaymentStatus.PENDING, PaymentStatus.FAILED],
                  },
                },
              },
            },
          ],
        },
        select: {
          id: true,
          orderNumber: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: UNPAID_ORDER_EXPIRATION.BATCH_SIZE,
      });

      if (expiredOrders.length === 0) {
        this.logger.debug('No expired unpaid orders eligible for release.');
        return;
      }

      this.logger.log(
        `Discovered ${expiredOrders.length} unpaid orders exceeding the ${UNPAID_ORDER_EXPIRATION.PENDING_TTL_MINUTES}m checkout window. Initiating inventory restoration and cancellation...`,
      );

      let cancelledCount = 0;

      for (const order of expiredOrders) {
        const success = await this.ordersService.cancelExpiredPendingOrder(
          order.id,
          `Payment window expired after ${UNPAID_ORDER_EXPIRATION.PENDING_TTL_MINUTES} minutes`,
        );

        if (success) {
          cancelledCount += 1;
        }
      }

      const elapsedMs = Date.now() - startedAt;
      this.logger.log(
        `Unpaid orders sweep finished in ${elapsedMs}ms: successfully cancelled ${cancelledCount}/${expiredOrders.length} orders and restored reserved inventory.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error during unpaid orders expiration sweep: ${message}`,
      );
    } finally {
      await this.redis
        .eval(RELEASE_LOCK_LUA, 1, this.lockKey, lockToken)
        .catch(() => null);
    }
  }
}

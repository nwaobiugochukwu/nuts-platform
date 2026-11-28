import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Injectable, Optional } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

/**
 * Whether a shopper is still a first-time shopper, which decides if "first order only" offers apply
 * to them. Shared by the offers shown on the storefront and the check at checkout, so the two cannot
 * disagree.
 */
@Injectable()
export class FirstOrderEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  /** Whether the shopper has placed an order that was not cancelled (cached for five minutes). */
  async hasPriorOrders(userId?: string): Promise<boolean> {
    if (!userId) return false;
    if (this.cacheService) {
      return this.cacheService.wrap(
        `user:has-prior-orders:${userId}`,
        300,
        async () => {
          const count = await this.prisma.order.count({
            where: {
              userId,
              status: { not: OrderStatus.CANCELLED },
            },
          });
          return count > 0;
        },
      );
    }
    const count = await this.prisma.order.count({
      where: {
        userId,
        status: { not: OrderStatus.CANCELLED },
      },
    });
    return count > 0;
  }

  /** Call after an order is created so first-order promos disappear at once. */
  async invalidate(userId: string): Promise<void> {
    await this.cacheService?.del(`user:has-prior-orders:${userId}`);
  }
}

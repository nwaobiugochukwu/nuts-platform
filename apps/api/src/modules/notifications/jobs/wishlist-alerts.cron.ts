import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  NotificationPriority,
  NotificationType,
  Prisma,
  ROLE,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { getErrorMessage } from '@api/common/utils/error-details.util';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';
import { NotificationsService } from '../notifications.service';

const LOCK_KEY = 'lock:cron:wishlist-alerts';
const LOCK_TTL_SECONDS = 300;
const BATCH_SIZE = 300;

@Injectable()
export class WishlistAlertsCron {
  private readonly logger = new Logger(WishlistAlertsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async renewLock(lockToken: string): Promise<void> {
    const renewed = await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      LOCK_KEY,
      lockToken,
      LOCK_TTL_SECONDS,
    );
    if (Number(renewed) !== 1)
      throw new Error('Wishlist alert lock ownership was lost.');
  }

  @Cron('0 */15 * * * *', {
    name: 'wishlist-price-and-restock-alerts',
    timeZone: 'Africa/Lagos',
  })
  async handleWishlistAlerts(): Promise<void> {
    const lockToken = randomUUID();
    try {
      const acquired = await this.redis.set(
        LOCK_KEY,
        lockToken,
        'EX',
        LOCK_TTL_SECONDS,
        'NX',
      );
      if (!acquired) return;
    } catch (error) {
      this.logger.error(
        `Could not acquire wishlist alert lock: ${getErrorMessage(error)}`,
      );
      return;
    }

    let cursor: string | undefined;
    let changed = 0;
    try {
      for (;;) {
        await this.renewLock(lockToken);
        const items = await this.prisma.wishlistItem.findMany({
          where: {
            ...(cursor ? { id: { gt: cursor } } : {}),
            lastObservedPrice: { not: null },
            lastObservedStock: { not: null },
            product: {
              isActive: true,
              isDeleted: false,
              vendor: { isActive: true, isApproved: true },
            },
          },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          select: {
            id: true,
            userId: true,
            productId: true,
            variantId: true,
            lastObservedPrice: true,
            lastObservedStock: true,
            lastObservedAt: true,
            variant: {
              select: { stock: true, isActive: true, isDeleted: true },
            },
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                price: true,
                stock: true,
                hasVariants: true,
              },
            },
          },
        });
        if (items.length === 0) break;
        cursor = items[items.length - 1].id;

        const variantProductIds = [
          ...new Set(
            items
              .filter((item) => !item.variantId && item.product.hasVariants)
              .map((item) => item.productId),
          ),
        ];
        const variantStocks = variantProductIds.length
          ? await this.prisma.productVariant.groupBy({
              by: ['productId'],
              where: {
                productId: { in: variantProductIds },
                isActive: true,
                isDeleted: false,
              },
              _sum: { stock: true },
            })
          : [];
        const variantStockByProductId = new Map(
          variantStocks.map((row) => [
            row.productId,
            Math.max(0, row._sum.stock ?? 0),
          ]),
        );

        for (const item of items) {
          const currentPrice = new Prisma.Decimal(item.product.price);
          const currentStock = item.variantId
            ? item.variant?.isActive && !item.variant.isDeleted
              ? Math.max(0, item.variant.stock)
              : 0
            : item.product.hasVariants
              ? (variantStockByProductId.get(item.productId) ?? 0)
              : Math.max(0, item.product.stock);
          const previousPrice = new Prisma.Decimal(item.lastObservedPrice!);
          const previousStock = item.lastObservedStock!;
          const priceDropped = currentPrice.lessThan(previousPrice);
          const restocked = previousStock <= 0 && currentStock > 0;
          if (!priceDropped && !restocked) continue;

          const snapshotKey = item.lastObservedAt.toISOString();
          if (priceDropped) {
            await this.notifications.create({
              userId: item.userId,
              role: ROLE.USER,
              type: NotificationType.PRICE_DROP,
              title: 'A saved item is now cheaper',
              message: `${item.product.name} dropped to ₦${currentPrice.toFixed(2)}.`,
              priority: NotificationPriority.MEDIUM,
              link: `/product/${item.product.slug}`,
              dedupeKey: `wishlist:${item.id}:price-drop:${snapshotKey}`,
              metadata: {
                productId: item.productId,
                previousPrice: previousPrice.toString(),
                currentPrice: currentPrice.toString(),
              },
            });
          }
          if (restocked) {
            await this.notifications.create({
              userId: item.userId,
              role: ROLE.USER,
              type: NotificationType.RESTOCKED,
              title: 'A saved item is back in stock',
              message: `${item.product.name} is available again.`,
              priority: NotificationPriority.MEDIUM,
              link: `/product/${item.product.slug}`,
              dedupeKey: `wishlist:${item.id}:restocked:${snapshotKey}`,
              metadata: {
                productId: item.productId,
                previousStock,
                currentStock,
              },
            });
          }

          const updated = await this.prisma.wishlistItem.updateMany({
            where: {
              id: item.id,
              lastObservedAt: item.lastObservedAt,
              lastObservedPrice: previousPrice,
              lastObservedStock: previousStock,
            },
            data: {
              lastObservedPrice: currentPrice,
              lastObservedStock: currentStock,
              lastObservedAt: new Date(),
            },
          });
          changed += updated.count;
        }
      }
      if (changed > 0)
        this.logger.log(
          `Updated alert snapshots for ${changed} saved item(s).`,
        );
    } catch (error) {
      this.logger.error(
        `Wishlist alert check failed: ${getErrorMessage(error)}`,
      );
    } finally {
      try {
        await this.redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          LOCK_KEY,
          lockToken,
        );
      } catch (error) {
        this.logger.warn(
          `Could not release wishlist alert lock: ${getErrorMessage(error)}`,
        );
      }
    }
  }
}

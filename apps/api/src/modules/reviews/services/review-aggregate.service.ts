import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { productReviewsCacheKeys } from '../constants/review-cache.constants';

export interface RatingSummary {
  count: number;
  /** One decimal place, 0 when there are no reviews. */
  average: number;
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
}

/**
 * Keeps the rating summary on each product (count, average, how many of each star).
 *
 * The summary is **recomputed from the active reviews**, never incremented. That makes it correct
 * however the events arrive: a duplicate, a late event, or two reviews landing at once all end in
 * the same numbers (the outbox does not promise order; see ADR 0006).
 */
@Injectable()
export class ReviewAggregateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async recompute(productId: string): Promise<RatingSummary> {
    const groups = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { productId, isActive: true },
      _count: { _all: true },
    });

    const breakdown: RatingSummary['breakdown'] = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    let count = 0;
    let sum = 0;
    for (const group of groups) {
      const star = Math.min(5, Math.max(1, Math.round(group.rating))) as
        | 1
        | 2
        | 3
        | 4
        | 5;
      breakdown[star] += group._count._all;
      count += group._count._all;
      sum += group.rating * group._count._all;
    }
    const average = count > 0 ? Number((sum / count).toFixed(1)) : 0;

    // updateMany: a product that was deleted since the event is simply nothing to update.
    await this.prisma.product.updateMany({
      where: { id: productId },
      data: {
        ratingCount: count,
        ratingAverage: average,
        ratingBreakdown: count > 0 ? breakdown : undefined,
      },
    });

    // The cached review list carries the summary, so it must not outlive it.
    await Promise.all(
      productReviewsCacheKeys(productId).map((key) => this.cache.del(key)),
    );

    return { count, average, breakdown };
  }
}

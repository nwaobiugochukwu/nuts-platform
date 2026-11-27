import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ShopperActivityPublisherService } from './shopper-activity-publisher.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';

@Injectable()
export class SearchTrackingService {
  private readonly logger = new Logger(SearchTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    @Optional() private readonly queue?: ShopperActivityPublisherService,
  ) {}

  /**
   * Track a search query for analytics.
   */
  async trackSearch(
    query: string,
    resultsCount: number,
    userId?: string,
    sessionId?: string,
    visitorId?: string,
    cacheUserId?: string,
  ): Promise<void> {
    // Preferred path: the analytics queue stores it and refreshes the recommendations once
    // the row exists (so the refresh can never run before the signal is stored). If the broker
    // is down, store it here and refresh at once, as before.
    const id = randomUUID();
    const queued = await this.queue?.record({
      action: 'searched',
      id,
      query,
      resultsCount,
      userId: userId ?? null,
      sessionId: sessionId ?? null,
      visitorId: visitorId ?? null,
    });
    if (queued) {
      if (resultsCount === 0) {
        this.logger.debug({ query }, 'Zero-result search tracked');
      }
      return;
    }

    await this.prisma.searchQuery.create({
      data: {
        query,
        resultsCount,
        userId: userId ?? null,
        sessionId: sessionId ?? null,
      },
    });

    await this.cache
      .invalidateRecommendations(userId, cacheUserId, sessionId, visitorId)
      .catch(() => undefined);

    if (resultsCount === 0) {
      this.logger.debug({ query }, 'Zero-result search tracked');
    }
  }
}

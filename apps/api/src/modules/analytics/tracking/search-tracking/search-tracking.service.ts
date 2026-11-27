import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';

@Injectable()
export class SearchTrackingService {
  private readonly logger = new Logger(SearchTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
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
    // Persist synchronously (not via the message queue) so the signal is
    // already in the database when recommendations are recomputed below.
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

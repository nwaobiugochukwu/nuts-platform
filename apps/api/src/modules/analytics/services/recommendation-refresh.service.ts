import { CacheService } from '@api/infrastructure/cache/cache.service';
import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';

/** How long clicks are allowed to pile up before the feed is recomputed once. */
export const REFRESH_DEBOUNCE_MS = 3_000;

/**
 * Clears a shopper's cached recommendations after their clicks, once per burst.
 *
 * Every click used to clear the cache at once, and the feed behind it is the most expensive read
 * on the site (p95 of 2 to 3 seconds), so ten clicks meant ten recomputations of which nine were
 * thrown away. Now the first signal starts a short timer; signals that arrive while it runs join
 * it; when it fires the cache is cleared once and the next read sees all of them.
 */
@Injectable()
export class RecommendationRefreshService implements OnModuleDestroy {
  private readonly logger = new Logger(RecommendationRefreshService.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(@Optional() private readonly cache?: CacheService) {}

  /** Schedules one cache clear for these identities (user ids, session ids, visitor ids). */
  schedule(...identities: Array<string | null | undefined>): void {
    for (const id of new Set(identities.filter((i): i is string => !!i))) {
      if (this.pending.has(id)) continue;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.cache?.invalidateRecommendations(id).catch((error: unknown) => {
          this.logger.warn(
            `Could not refresh recommendations: ${String(error)}`,
          );
        });
      }, REFRESH_DEBOUNCE_MS);
      timer.unref();
      this.pending.set(id, timer);
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}

import { CacheService } from '@api/infrastructure/cache/cache.service';
import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';

/** How long clicks are allowed to pile up before the feed is recomputed once. */
export const REFRESH_DEBOUNCE_MS = 3_000;

/** Who a feed belongs to: the same triple the feed itself is computed from. */
export interface FeedActor {
  userId?: string | null;
  sessionId?: string | null;
  visitorId?: string | null;
}

export type FeedWarmer = (actor: FeedActor) => Promise<unknown>;

interface PendingRefresh {
  timer: NodeJS.Timeout;
  identities: Set<string>;
  actor?: FeedActor;
}

/**
 * Refreshes a shopper's recommendations after their clicks, once per burst, and warms the result.
 *
 * Every click used to clear the cache at once, and the feed behind it is the most expensive read on
 * the site (p95 of 2 to 3 seconds), so ten clicks meant ten recomputations of which nine were
 * thrown away, and the one that counted ran on the request. Now the first signal starts a short
 * timer; signals that arrive while it runs join it; when it fires the cache is cleared once and the
 * feed is recomputed here, in the worker, so the shopper's next read is a cache hit.
 */
@Injectable()
export class RecommendationRefreshService implements OnModuleDestroy {
  private readonly logger = new Logger(RecommendationRefreshService.name);
  private readonly pending = new Map<string, PendingRefresh>();
  private warmer?: FeedWarmer;

  constructor(@Optional() private readonly cache?: CacheService) {}

  /** The feed registers how to compute itself, so analytics need not depend on recommendations. */
  registerWarmer(warmer: FeedWarmer): void {
    this.warmer = warmer;
  }

  /**
   * Schedules one clear (and, with an `actor` and a registered warmer, one recompute) for these
   * identities (user ids, session ids, visitor ids).
   */
  schedule(
    identities: Array<string | null | undefined>,
    actor?: FeedActor,
  ): void {
    const ids = [...new Set(identities.filter((i): i is string => !!i))];
    const key =
      actor?.userId ?? actor?.visitorId ?? actor?.sessionId ?? ids[0] ?? null;
    if (!key) return;

    const existing = this.pending.get(key);
    if (existing) {
      for (const id of ids) existing.identities.add(id);
      return;
    }

    const entry: PendingRefresh = {
      identities: new Set(ids),
      actor,
      timer: setTimeout(() => {
        this.pending.delete(key);
        void this.run(entry);
      }, REFRESH_DEBOUNCE_MS),
    };
    entry.timer.unref();
    this.pending.set(key, entry);
  }

  private async run(entry: PendingRefresh): Promise<void> {
    try {
      await this.cache?.invalidateRecommendations(...entry.identities);
      if (entry.actor && this.warmer) await this.warmer(entry.actor);
    } catch (error) {
      this.logger.warn(`Could not refresh recommendations: ${String(error)}`);
    }
  }

  onModuleDestroy(): void {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}

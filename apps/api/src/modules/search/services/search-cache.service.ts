import { CACHE_TTL_SECONDS } from '../constants/search.constants';
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * The Redis layer search results are cached in. Redis is a performance layer: a failure here must
 * never make search unavailable, so every call swallows its error (and logs it) and the caller falls
 * back to the database.
 */
@Injectable()
export class SearchCacheService {
  private readonly logger = new Logger(SearchCacheService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);

      if (!cached) {
        return null;
      }

      return JSON.parse(cached) as T;
    } catch (error) {
      /*
       * Redis is a performance layer.
       *
       * A Redis failure should not make database search unavailable.
       */
      this.logger.warn(`Search cache read failed for key ${key}`, error);

      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      /*
       * Search results remain correct even if caching fails.
       */
      this.logger.warn(`Search cache write failed for key ${key}`, error);
    }
  }

  /** Purges every cached search query; returns how many were removed. */
  async flush(): Promise<number> {
    try {
      const keys = await this.redis.keys('search:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      return keys.length;
    } catch (error) {
      this.logger.warn('Failed to flush search cache keys', error);
      return 0;
    }
  }
}

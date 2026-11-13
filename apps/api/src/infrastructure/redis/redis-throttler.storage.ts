import { Inject, Injectable, Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

/**
 * Redis-backed storage for @nestjs/throttler.
 *
 * Replaces the default in-memory storage so rate limits are shared across
 * all server instances and survive restarts. Uses a fixed-window counter
 * per key (`INCR` + `PEXPIRE`) which is atomic and cheap.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  private static readonly RATE_LIMIT_SCRIPT = `
    local current = redis.call('INCR', KEYS[1])
    if current == 1 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
    local ttlMs = redis.call('PTTL', KEYS[1])
    if tonumber(ARGV[2]) > 0 and current > tonumber(ARGV[3]) then
      redis.call('EXPIRE', KEYS[1], ARGV[2])
    end
    return {current, math.ceil(ttlMs / 1000)}
  `;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    const redisKey = `ratelimit:${throttlerName}:${key}`;
    const blockSeconds = Math.ceil(blockDuration / 1000);

    try {
      const [totalHitsRaw, timeToExpireRaw] = (await this.redis.eval(
        RedisThrottlerStorage.RATE_LIMIT_SCRIPT,
        1,
        redisKey,
        String(ttl),
        String(blockSeconds),
        String(limit),
      )) as [number, number];

      const totalHits = Number(totalHitsRaw ?? 1);
      const timeToExpire = Math.max(0, Number(timeToExpireRaw ?? 0));
      const isBlocked = totalHits > limit;

      return {
        totalHits,
        timeToExpire,
        isBlocked,
        timeToBlockExpire: isBlocked ? blockSeconds : 0,
      };
    } catch (error) {
      // Production Resiliency: Fail OPEN if Redis rate limit check fails or times out.
      // An infrastructure hiccup should never crash user HTTP requests with 500s.
      this.logger.warn(
        `Rate limit check failed for "${redisKey}": ${
          error instanceof Error ? error.message : String(error)
        }. Failing open.`,
      );

      return {
        totalHits: 1,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}

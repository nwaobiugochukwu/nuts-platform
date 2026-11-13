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
  private readonly emergencyCounters = new Map<
    string,
    { totalHits: number; expiresAt: number; blockedUntil: number }
  >();
  private static readonly MAX_EMERGENCY_COUNTERS = 20_000;
  private static readonly WARNING_INTERVAL_MS = 30_000;
  private lastFallbackWarningAt = 0;

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
      const now = Date.now();
      if (
        now - this.lastFallbackWarningAt >=
        RedisThrottlerStorage.WARNING_INTERVAL_MS
      ) {
        this.lastFallbackWarningAt = now;
        this.logger.warn(
          `Shared rate-limit storage unavailable; using bounded per-instance counters (${throttlerName}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return this.incrementEmergencyCounter(
        `${throttlerName}:${key}`,
        ttl,
        limit,
        blockDuration,
        now,
      );
    }
  }

  private incrementEmergencyCounter(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    now: number,
  ): {
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  } {
    let counter = this.emergencyCounters.get(key);
    if (!counter || counter.expiresAt <= now) {
      counter = {
        totalHits: 0,
        expiresAt: now + Math.max(1, ttl),
        blockedUntil: 0,
      };
    }

    counter.totalHits += 1;
    if (counter.totalHits > limit && blockDuration > 0) {
      counter.blockedUntil = now + blockDuration;
    }

    this.emergencyCounters.delete(key);
    this.emergencyCounters.set(key, counter);
    this.pruneEmergencyCounters(now);

    const remainingBlockMs = Math.max(0, counter.blockedUntil - now);
    return {
      totalHits: counter.totalHits,
      timeToExpire: Math.max(0, Math.ceil((counter.expiresAt - now) / 1000)),
      isBlocked: counter.totalHits > limit,
      timeToBlockExpire: Math.ceil(remainingBlockMs / 1000),
    };
  }

  private pruneEmergencyCounters(now: number): void {
    if (
      this.emergencyCounters.size < RedisThrottlerStorage.MAX_EMERGENCY_COUNTERS
    ) {
      return;
    }

    for (const [key, counter] of this.emergencyCounters) {
      if (counter.expiresAt <= now) this.emergencyCounters.delete(key);
      if (
        this.emergencyCounters.size <
        RedisThrottlerStorage.MAX_EMERGENCY_COUNTERS
      ) {
        return;
      }
    }

    const oldestKey = this.emergencyCounters.keys().next().value;
    if (oldestKey !== undefined) this.emergencyCounters.delete(oldestKey);
  }
}

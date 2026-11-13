import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { SECURITY } from '@api/common/constants';

/**
 * Service to implement progressive login delays.
 * Each failed login attempt increases the delay before the next attempt is allowed.
 */
@Injectable()
export class ProgressiveDelayService {
  private readonly logger = new Logger(ProgressiveDelayService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /**
   * Check if the user needs to wait before attempting login.
   * Returns the number of milliseconds to wait.
   */
  async getDelay(identifier: string): Promise<number> {
    try {
      const key = `login:delay:${identifier}`;
      const attemptsStr = await this.redis.get(key);

      if (!attemptsStr) {
        return 0;
      }

      const attempts = parseInt(attemptsStr, 10);
      // Exponential backoff: base * 2^attempts, capped
      const delay = Math.min(
        SECURITY.PROGRESSIVE_DELAY_BASE_MS * Math.pow(2, attempts - 1),
        30000, // max 30 seconds
      );

      return delay;
    } catch (err) {
      this.logger.warn(
        `Failed to get progressive delay: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  /**
   * Increment the delay counter after a failed login.
   */
  async recordFailedAttempt(identifier: string): Promise<void> {
    try {
      const key = `login:delay:${identifier}`;
      const attempts = await this.redis.incr(key);

      // Set TTL to 15 minutes from first attempt
      if (attempts === 1) {
        await this.redis.expire(key, 900);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to record failed login attempt in progressive delay: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Reset delay counter on successful login.
   */
  async resetDelay(identifier: string): Promise<void> {
    try {
      const key = `login:delay:${identifier}`;
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(
        `Failed to reset progressive delay: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

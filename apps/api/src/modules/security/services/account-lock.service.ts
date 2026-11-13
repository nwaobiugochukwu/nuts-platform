import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { SECURITY } from '@api/common/constants';

@Injectable()
export class AccountLockService {
  private readonly logger = new Logger(AccountLockService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /**
   * Record a failed login attempt for the given identifier.
   * Returns the current attempt count.
   */
  async recordFailedAttempt(identifier: string): Promise<number> {
    try {
      const key = `login:attempts:${this.hashIdentifier(identifier)}`;
      const attempts = await this.redis.incr(key);

      // Set TTL on first attempt, or ensure TTL is present if missing
      if (attempts === 1) {
        await this.redis.expire(key, SECURITY.LOCKOUT_DURATION_MINUTES * 60);
      } else {
        const ttl = await this.redis.ttl(key);
        if (ttl === -1) {
          await this.redis.expire(key, SECURITY.LOCKOUT_DURATION_MINUTES * 60);
        }
      }

      if (attempts >= SECURITY.MAX_LOGIN_ATTEMPTS) {
        await this.lockAccount(identifier);
        await this.redis.del(key);
      }

      return attempts;
    } catch (err) {
      this.logger.warn(
        `Failed to record failed login attempt in Redis: ${err instanceof Error ? err.message : String(err)}`,
      );
      return SECURITY.LOCKOUT_DURATION_MINUTES * 60;
    }
  }

  /**
   * Check if an account is locked.
   */
  async isLocked(identifier: string): Promise<boolean> {
    try {
      const lockKey = `login:locked:${this.hashIdentifier(identifier)}`;
      const locked = await this.redis.get(lockKey);
      return locked !== null;
    } catch (err) {
      this.logger.warn(
        `Failed to check account lock in Redis: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException(
        'Login protection is temporarily unavailable. Please try again shortly.',
      );
    }
  }

  /**
   * Get remaining lockout time in seconds.
   */
  async getLockoutTimeRemaining(identifier: string): Promise<number> {
    try {
      const lockKey = `login:locked:${this.hashIdentifier(identifier)}`;
      const ttl = await this.redis.ttl(lockKey);
      return Math.max(0, ttl);
    } catch (err) {
      this.logger.warn(
        `Failed to get lockout time remaining: ${err instanceof Error ? err.message : String(err)}`,
      );
      return SECURITY.LOCKOUT_DURATION_MINUTES * 60;
    }
  }

  /**
   * Reset failed attempt counter on successful login.
   */
  async resetAttempts(identifier: string): Promise<void> {
    try {
      const key = `login:attempts:${this.hashIdentifier(identifier)}`;
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(
        `Failed to reset login attempts: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Lock an account for the configured duration.
   */
  private async lockAccount(identifier: string): Promise<void> {
    try {
      const identifierHash = this.hashIdentifier(identifier);
      const lockKey = `login:locked:${identifierHash}`;
      await this.redis.setex(
        lockKey,
        SECURITY.LOCKOUT_DURATION_MINUTES * 60,
        '1',
      );
      this.logger.warn(
        { identifierHash },
        'Account locked due to too many failed attempts',
      );
    } catch (err) {
      this.logger.warn(
        `Failed to lock account in Redis: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private hashIdentifier(identifier: string): string {
    return createHash('sha256').update(identifier).digest('hex');
  }
}

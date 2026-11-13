import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import Redlock, { Lock, RedlockAbortSignal } from 'redlock';
import { getErrorMessage } from '@api/common/utils/error-details.util';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedlockService {
  private readonly logger = new Logger(RedlockService.name);
  private readonly redlock: Redlock;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.redlock = new Redlock([this.redis], {
      driftFactor: 0.01,
      retryCount: 10,
      retryDelay: 200,
      retryJitter: 200,
      automaticExtensionThreshold: 500,
    });

    this.redlock.on('error', (error: unknown) => {
      this.logger.warn(`Redlock non-fatal error: ${getErrorMessage(error)}`);
    });
  }

  public async acquire(resources: string[], ttl = 5000): Promise<Lock> {
    return this.redlock.acquire(resources, ttl);
  }

  public async using<T>(
    resources: string[],
    ttl: number,
    routine: (signal: RedlockAbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.redlock.using(resources, ttl, routine);
  }
}

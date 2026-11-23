// user-account-cleanup.service.ts

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.module';
import { runWithCronLock } from '@api/infrastructure/redis/cron-lock';

import { UsersService } from '../users.service';

@Injectable()
export class UserAccountCleanupService {
  private readonly logger = new Logger(UserAccountCleanupService.name);

  constructor(
    private readonly usersService: UsersService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeExpiredDeactivatedAccounts(): Promise<void> {
    try {
      // One replica only: two instances purging the same accounts at once
      // would race on cascading deletes.
      await runWithCronLock(
        this.redis,
        'cron:lock:user-account-cleanup',
        60 * 60_000,
        async () => {
          const deleted = await this.usersService.purgeScheduledDeletions();

          if (deleted > 0) {
            this.logger.log(
              `Permanently deleted ${deleted} deactivated account(s)`,
            );
          }
        },
      );
    } catch (error) {
      /*
       * Prevent an unexpected cron failure from becoming an unhandled
       * promise rejection and make the failure visible to monitoring.
       */
      this.logger.error(
        'Failed to purge expired deactivated accounts',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}

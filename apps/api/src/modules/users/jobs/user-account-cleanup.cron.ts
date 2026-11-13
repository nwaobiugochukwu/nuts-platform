// user-account-cleanup.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { UsersService } from '../users.service';

@Injectable()
export class UserAccountCleanupService {
  private readonly logger = new Logger(UserAccountCleanupService.name);

  constructor(private readonly usersService: UsersService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeExpiredDeactivatedAccounts(): Promise<void> {
    try {
      const deleted = await this.usersService.purgeScheduledDeletions();

      if (deleted > 0) {
        this.logger.log(
          `Permanently deleted ${deleted} deactivated account(s)`,
        );
      }
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

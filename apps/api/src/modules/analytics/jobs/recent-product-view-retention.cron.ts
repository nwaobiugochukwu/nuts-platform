import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const GUEST_HISTORY_DAYS = 30;
const ACCOUNT_HISTORY_DAYS = 180;

@Injectable()
export class RecentProductViewRetentionCron {
  private readonly logger = new Logger(RecentProductViewRetentionCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async removeExpiredRecentHistory(): Promise<void> {
    try {
      const guestCutoff = new Date(Date.now() - GUEST_HISTORY_DAYS * DAY_MS);
      const accountCutoff = new Date(
        Date.now() - ACCOUNT_HISTORY_DAYS * DAY_MS,
      );
      const result = await this.prisma.recentProductView.deleteMany({
        where: {
          OR: [
            { visitorId: { not: null }, lastViewedAt: { lt: guestCutoff } },
            { userId: { not: null }, lastViewedAt: { lt: accountCutoff } },
          ],
        },
      });
      if (result.count) {
        this.logger.log(
          `Removed ${result.count} expired recent product views.`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Recent product history cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

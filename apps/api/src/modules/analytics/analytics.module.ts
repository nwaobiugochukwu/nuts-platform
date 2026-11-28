import { Module } from '@nestjs/common';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { RedisModule } from '@api/infrastructure/cache/redis.module';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { VendorAnalyticsController } from './controllers/vendor-analytics.controller';
import { VendorSummaryJob } from './jobs/vendor-summary.job';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { AdminAnalyticsAuditService } from './services/admin-analytics-audit.service';
import { AdminAnalyticsProductsService } from './services/admin-analytics-products.service';
import { AdminAnalyticsPromotionsService } from './services/admin-analytics-promotions.service';
import { AdminAnalyticsRevenueService } from './services/admin-analytics-revenue.service';
import { AdminAnalyticsUsersService } from './services/admin-analytics-users.service';
import { ShopperEngagementService } from './services/shopper-engagement.service';
import { VendorAnalyticsService } from './services/vendor-analytics.service';

/**
 * Reporting for administrators and vendors: revenue, products, users, promotions, the audit trail
 * and how shoppers engage (stores opened, carts, wishlists). It only reads. The shopper activity it
 * reports on is captured and stored by the `shopper-activity` module.
 */
@Module({
  imports: [PrismaModule, RedisModule, CacheModule],
  controllers: [AdminAnalyticsController, VendorAnalyticsController],
  providers: [
    AdminAnalyticsService,
    AdminAnalyticsRevenueService,
    AdminAnalyticsProductsService,
    AdminAnalyticsUsersService,
    AdminAnalyticsPromotionsService,
    AdminAnalyticsAuditService,
    VendorAnalyticsService,
    ShopperEngagementService,
    VendorSummaryJob,
  ],
  exports: [
    AdminAnalyticsService,
    AdminAnalyticsRevenueService,
    AdminAnalyticsProductsService,
    AdminAnalyticsUsersService,
    AdminAnalyticsPromotionsService,
    AdminAnalyticsAuditService,
    VendorAnalyticsService,
    ShopperEngagementService,
  ],
})
export class AnalyticsModule {}

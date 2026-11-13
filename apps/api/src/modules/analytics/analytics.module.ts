import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/prisma/prisma.module';
import { RedisModule } from '@api/infrastructure/redis/redis.module';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { AdminAnalyticsService } from './admin/admin-analytics.service';
import { AdminAnalyticsAuditService } from './admin/admin-analytics-audit.service';
import { AdminAnalyticsProductsService } from './admin/admin-analytics-products.service';
import { AdminAnalyticsPromotionsService } from './admin/admin-analytics-promotions.service';
import { AdminAnalyticsRevenueService } from './admin/admin-analytics-revenue.service';
import { AdminAnalyticsUsersService } from './admin/admin-analytics-users.service';
import { VendorAnalyticsController } from './controllers/vendor-analytics.controller';
import { VendorAnalyticsService } from './vendors/vendor-analytics.service';
import { ProductViewsService } from './tracking/product-views/product-views.service';
import { SearchTrackingService } from './tracking/search-tracking/search-tracking.service';
import { VendorSummaryCron } from './jobs/vendor-summary.cron';
import { AnalyticsEventsController } from './controllers/analytics-events.controller';
import { RecommendationEventsService } from './tracking/recommendation-events.service';
import { RecommendationEventsRetentionCron } from './jobs/recommendation-events-retention.cron';
import { RecentProductViewRetentionCron } from './jobs/recent-product-view-retention.cron';
import { AnalyticsEventRetentionCron } from './jobs/analytics-event-retention.cron';
import { MarketplaceEventsController } from './controllers/marketplace-events.controller';
import { MarketplaceEventsService } from './tracking/marketplace-events.service';
import { MarketplaceAnalyticsService } from './marketplace-analytics.service';

@Module({
  imports: [PrismaModule, RedisModule, CacheModule],
  controllers: [
    AdminAnalyticsController,
    VendorAnalyticsController,
    AnalyticsEventsController,
    MarketplaceEventsController,
  ],
  providers: [
    AdminAnalyticsService,
    AdminAnalyticsRevenueService,
    AdminAnalyticsProductsService,
    AdminAnalyticsUsersService,
    AdminAnalyticsPromotionsService,
    AdminAnalyticsAuditService,
    VendorAnalyticsService,
    ProductViewsService,
    SearchTrackingService,
    RecommendationEventsService,
    MarketplaceEventsService,
    MarketplaceAnalyticsService,
    RecommendationEventsRetentionCron,
    RecentProductViewRetentionCron,
    AnalyticsEventRetentionCron,
    VendorSummaryCron,
  ],
  exports: [
    AdminAnalyticsService,
    AdminAnalyticsRevenueService,
    AdminAnalyticsProductsService,
    AdminAnalyticsUsersService,
    AdminAnalyticsPromotionsService,
    AdminAnalyticsAuditService,
    VendorAnalyticsService,
    ProductViewsService,
    SearchTrackingService,
    RecommendationEventsService,
    MarketplaceEventsService,
    MarketplaceAnalyticsService,
  ],
})
export class AnalyticsModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { RedisModule } from '@api/infrastructure/cache/redis.module';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { AdminAnalyticsAuditService } from './services/admin-analytics-audit.service';
import { AdminAnalyticsProductsService } from './services/admin-analytics-products.service';
import { AdminAnalyticsPromotionsService } from './services/admin-analytics-promotions.service';
import { AdminAnalyticsRevenueService } from './services/admin-analytics-revenue.service';
import { AdminAnalyticsUsersService } from './services/admin-analytics-users.service';
import { VendorAnalyticsController } from './controllers/vendor-analytics.controller';
import { VendorAnalyticsService } from './services/vendor-analytics.service';
import { ProductViewsService } from './services/product-views.service';
import { SearchTrackingService } from './services/search-tracking.service';
import { RecommendationRefreshService } from './services/recommendation-refresh.service';
import { ShopperActivityPublisherService } from './services/shopper-activity-publisher.service';
import { AnalyticsConsumer } from './consumers/analytics.consumer';
import { VendorSummaryJob } from './jobs/vendor-summary.job';
import { AnalyticsEventsController } from './controllers/analytics-events.controller';
import { RecommendationEventsService } from './services/recommendation-events.service';
import { RecommendationEventsRetentionJob } from './jobs/recommendation-events-retention.job';
import { RecentProductViewRetentionJob } from './jobs/recent-product-view-retention.job';
import { AnalyticsEventRetentionJob } from './jobs/analytics-event-retention.job';
import { StoreViewController } from './controllers/store-view.controller';
import { ShopperActivityService } from './services/shopper-activity.service';
import { MarketplaceAnalyticsService } from './services/marketplace-analytics.service';

@Module({
  imports: [PrismaModule, RedisModule, CacheModule],
  controllers: [
    AdminAnalyticsController,
    VendorAnalyticsController,
    AnalyticsEventsController,
    StoreViewController,
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
    ShopperActivityPublisherService,
    RecommendationRefreshService,
    RecommendationEventsService,
    ShopperActivityService,
    MarketplaceAnalyticsService,
    RecommendationEventsRetentionJob,
    RecentProductViewRetentionJob,
    AnalyticsEventRetentionJob,
    VendorSummaryJob,
    AnalyticsConsumer,
  ],
  exports: [
    RecommendationRefreshService,
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
    ShopperActivityService,
    MarketplaceAnalyticsService,
  ],
})
export class AnalyticsModule {}

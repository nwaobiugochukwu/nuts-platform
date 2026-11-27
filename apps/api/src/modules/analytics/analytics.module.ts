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
import { TrackingQueueService } from './services/tracking-queue.service';
import { AnalyticsConsumer } from './consumers/analytics.consumer';
import { VendorSummaryJob } from './jobs/vendor-summary.job';
import { AnalyticsEventsController } from './controllers/analytics-events.controller';
import { RecommendationEventsService } from './services/recommendation-events.service';
import { RecommendationEventsRetentionJob } from './jobs/recommendation-events-retention.job';
import { RecentProductViewRetentionJob } from './jobs/recent-product-view-retention.job';
import { AnalyticsEventRetentionJob } from './jobs/analytics-event-retention.job';
import { MarketplaceEventsController } from './controllers/marketplace-events.controller';
import { MarketplaceEventsService } from './services/marketplace-events.service';
import { MarketplaceAnalyticsService } from './services/marketplace-analytics.service';

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
    TrackingQueueService,
    RecommendationRefreshService,
    RecommendationEventsService,
    MarketplaceEventsService,
    MarketplaceAnalyticsService,
    RecommendationEventsRetentionJob,
    RecentProductViewRetentionJob,
    AnalyticsEventRetentionJob,
    VendorSummaryJob,
    AnalyticsConsumer,
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

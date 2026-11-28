import { Module } from '@nestjs/common';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { RedisModule } from '@api/infrastructure/cache/redis.module';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { TrackingConsumer } from './consumers/tracking.consumer';
import { ActivityEventsController } from './controllers/activity-events.controller';
import { ActivityRetentionJob } from './jobs/activity-retention.job';
import { ProductViewsService } from './services/product-views.service';
import { RecommendationEventsService } from './services/recommendation-events.service';
import { RecommendationRefreshService } from './services/recommendation-refresh.service';
import { SearchTrackingService } from './services/search-tracking.service';
import { TrackingPublisherService } from './services/tracking-publisher.service';
import { TrackingRecorderService } from './services/tracking-recorder.service';
import { TrackingStoreService } from './services/tracking-store.service';
import { TrackingService } from './services/tracking.service';

/**
 * Everything a shopper does that the platform learns from: a product viewed, a search, a store
 * opened, a cart or wishlist change, a shelf item seen or clicked. This module takes it in (the
 * endpoints and the producers other modules call), stores it (the queue consumer and the direct
 * fallback share one store), and prunes it when it is old. Reporting on it lives in `analytics`.
 */
@Module({
  imports: [PrismaModule, RedisModule, CacheModule],
  controllers: [ActivityEventsController],
  providers: [
    ProductViewsService,
    SearchTrackingService,
    RecommendationEventsService,
    TrackingService,
    TrackingPublisherService,
    TrackingRecorderService,
    TrackingStoreService,
    RecommendationRefreshService,
    TrackingConsumer,
    ActivityRetentionJob,
  ],
  exports: [TrackingService, RecommendationRefreshService],
})
export class TrackingModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { TrackingModule } from '@api/modules/tracking/tracking.module';
import { ProductsModule } from '@api/modules/products/products.module';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { RecommendationsController } from './controllers/recommendations.controller';
import { GoodPlaceToStartService } from './services/good-place-to-start.service';
import { PersonalizedFeedService } from './services/personalized-feed.service';
import { PopularProductsService } from './services/popular-products.service';
import { RecommendationsService } from './services/recommendations.service';
import { RelatedProductsService } from './services/related-products.service';
import { SearchDiscoveryService } from './services/search-discovery.service';
import { StoreDiscoveryService } from './services/store-discovery.service';

@Module({
  imports: [PrismaModule, ProductsModule, CacheModule, TrackingModule],
  controllers: [RecommendationsController],
  providers: [
    PopularProductsService,
    StoreDiscoveryService,
    SearchDiscoveryService,
    PersonalizedFeedService,
    RelatedProductsService,
    GoodPlaceToStartService,
    RecommendationsService,
  ],
})
export class RecommendationsModule {}

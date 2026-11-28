import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { ShopperActivityModule } from '@api/modules/shopper-activity/shopper-activity.module';
import { ProductsModule } from '@api/modules/products/products.module';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { RecommendationsController } from './controllers/recommendations.controller';
import { PersonalizedFeedService } from './services/personalized-feed.service';
import { PopularProductsService } from './services/popular-products.service';
import { RecommendationsService } from './services/recommendations.service';
import { RelatedProductsService } from './services/related-products.service';
import { SearchDiscoveryService } from './services/search-discovery.service';
import { StoreDiscoveryService } from './services/store-discovery.service';

@Module({
  imports: [PrismaModule, ProductsModule, CacheModule, ShopperActivityModule],
  controllers: [RecommendationsController],
  providers: [
    PopularProductsService,
    StoreDiscoveryService,
    SearchDiscoveryService,
    PersonalizedFeedService,
    RelatedProductsService,
    RecommendationsService,
  ],
})
export class RecommendationsModule {}

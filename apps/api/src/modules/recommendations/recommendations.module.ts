import { Module } from '@nestjs/common';
import { PrismaModule } from '@api/infrastructure/database/prisma.module';
import { ProductsModule } from '@api/modules/products/products.module';
import { CacheModule } from '@api/infrastructure/cache/cache.module';
import { RecommendationsController } from './recommendations.controller';
import { PersonalizedFeedService } from './personalized-feed.service';
import { PopularProductsService } from './popular-products.service';
import { RecommendationsService } from './recommendations.service';
import { RelatedProductsService } from './related-products.service';
import { SearchDiscoveryService } from './search-discovery.service';
import { StoreDiscoveryService } from './store-discovery.service';

@Module({
  imports: [PrismaModule, ProductsModule, CacheModule],
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

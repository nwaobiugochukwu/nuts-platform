/** Trending products used as the popularity baseline for every shelf. */
import { Injectable, Optional } from '@nestjs/common';
import { ProductCatalogService } from '@api/modules/products/services/product-catalog.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';

import { RECOMMENDATION_LIMIT } from '../utils/recommendation.util';

@Injectable()
export class PopularProductsService {
  constructor(
    private readonly products: ProductCatalogService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  /** Wider trending pool so callers can drop already-seen items and still fill a shelf. */
  async discoverPool() {
    const fetcher = () =>
      this.products.findTrending({
        limit: 50,
        days: 30,
      });
    return this.cacheService
      ? this.cacheService.wrap('recommendations:discover-pool', 300, fetcher)
      : fetcher();
  }

  async discover() {
    return (await this.discoverPool()).slice(0, RECOMMENDATION_LIMIT);
  }
}

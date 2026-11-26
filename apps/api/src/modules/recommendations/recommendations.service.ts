import { Injectable } from '@nestjs/common';
import { PersonalizedFeedService } from './personalized-feed.service';
import { PopularProductsService } from './popular-products.service';
import { RelatedProductsService } from './related-products.service';
import { SearchDiscoveryService } from './search-discovery.service';
import { StoreDiscoveryService } from './store-discovery.service';

/**
 * Public recommendation API consumed by the controller. Each concern lives in
 * its own focused service; this facade only delegates, so callers and the HTTP
 * contract are unchanged.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly popular: PopularProductsService,
    private readonly feed: PersonalizedFeedService,
    private readonly search: SearchDiscoveryService,
    private readonly stores: StoreDiscoveryService,
    private readonly relatedProducts: RelatedProductsService,
  ) {}

  discover() {
    return this.popular.discover();
  }

  forYou(...args: Parameters<PersonalizedFeedService['forYou']>) {
    return this.feed.forYou(...args);
  }

  dismissProduct(
    ...args: Parameters<PersonalizedFeedService['dismissProduct']>
  ) {
    return this.feed.dismissProduct(...args);
  }

  recentlyViewed(
    ...args: Parameters<PersonalizedFeedService['recentlyViewed']>
  ) {
    return this.feed.recentlyViewed(...args);
  }

  claimRecentlyViewed(
    ...args: Parameters<PersonalizedFeedService['claimRecentlyViewed']>
  ) {
    return this.feed.claimRecentlyViewed(...args);
  }

  following(...args: Parameters<PersonalizedFeedService['following']>) {
    return this.feed.following(...args);
  }

  searchDiscover(
    ...args: Parameters<SearchDiscoveryService['searchDiscover']>
  ) {
    return this.search.searchDiscover(...args);
  }

  marketplaceMix(...args: Parameters<StoreDiscoveryService['marketplaceMix']>) {
    return this.stores.marketplaceMix(...args);
  }

  discoverStores(...args: Parameters<StoreDiscoveryService['discoverStores']>) {
    return this.stores.discoverStores(...args);
  }

  related(...args: Parameters<RelatedProductsService['related']>) {
    return this.relatedProducts.related(...args);
  }
}

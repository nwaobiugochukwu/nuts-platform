import { Injectable, Logger } from '@nestjs/common';
import type { ProductCardDto } from '@api/modules/products/dto/product-card.dto';
import {
  composeGoodPlaceToStart,
  type GoodPlaceToStartPick,
} from '../utils/good-place-to-start.util';
import { PersonalizedFeedService } from './personalized-feed.service';
import { StoreDiscoveryService } from './store-discovery.service';

/**
 * The home page's first shelf, built on the server in one request: a daily spread across stores,
 * topped up with products picked for the shopper. Both parts are cached by the services that build
 * them, so this only combines them.
 *
 * If one part fails the shelf is built from the other; it fails only when both do, so a problem in
 * one feed never blanks the first thing a visitor sees.
 */
@Injectable()
export class GoodPlaceToStartService {
  private readonly logger = new Logger(GoodPlaceToStartService.name);

  constructor(
    private readonly stores: StoreDiscoveryService,
    private readonly feed: PersonalizedFeedService,
  ) {}

  async picks(
    userId?: string,
    sessionId?: string,
    visitorId?: string,
  ): Promise<{ items: GoodPlaceToStartPick[] }> {
    const [sampler, forYou] = await Promise.allSettled([
      this.stores.starterSampler(userId, sessionId, visitorId),
      this.feed.forYou(userId, sessionId, visitorId),
    ]);
    if (sampler.status === 'rejected' && forYou.status === 'rejected') {
      throw sampler.reason;
    }
    if (sampler.status === 'rejected') {
      this.logger.warn(
        `Store sampler unavailable: ${describe(sampler.reason)}`,
      );
    }
    if (forYou.status === 'rejected') {
      this.logger.warn(`For-you feed unavailable: ${describe(forYou.reason)}`);
    }

    const vendors = sampler.status === 'fulfilled' ? sampler.value.vendors : [];
    const personal: ProductCardDto[] =
      forYou.status === 'fulfilled' ? forYou.value : [];
    return { items: composeGoodPlaceToStart(vendors, personal) };
  }
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

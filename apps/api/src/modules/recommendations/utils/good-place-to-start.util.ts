import type { ProductCardDto } from '@api/modules/products/dto/product-card.dto';

/** The most items the "Good place to start" shelf shows. */
export const GOOD_PLACE_TO_START_LIMIT = 12;

/** Where an item came from, so the shelf can say why a shopper is seeing it. */
export type GoodPlaceToStartSource = 'store_sampler' | 'for_you';

export interface GoodPlaceToStartPick {
  product: ProductCardDto;
  source: GoodPlaceToStartSource;
}

/**
 * Builds the shelf for a shopper who may have little or no history: a spread of the marketplace first
 * (one product from each of several stores, so no store crowds the shelf), then, if there are still
 * slots, products picked for this shopper from what they have done.
 *
 * Rules, in order: a product needs a store and a picture; no product appears twice; no store appears
 * twice; at most `limit` items. A brand-new visitor therefore gets the marketplace spread alone, and a
 * returning shopper gets the spread topped up with their own picks.
 */
export function composeGoodPlaceToStart(
  samplerVendors: ReadonlyArray<{ products: ProductCardDto[] }>,
  forYou: readonly ProductCardDto[],
  limit: number = GOOD_PLACE_TO_START_LIMIT,
): GoodPlaceToStartPick[] {
  const picks: GoodPlaceToStartPick[] = [];
  const productIds = new Set<string>();
  const vendorIds = new Set<string>();

  const add = (product: ProductCardDto, source: GoodPlaceToStartSource) => {
    const vendorId = product.vendor?.id;
    if (
      !vendorId ||
      !product.thumbnail ||
      productIds.has(product.id) ||
      vendorIds.has(vendorId) ||
      picks.length >= limit
    ) {
      return;
    }
    picks.push({ product, source });
    productIds.add(product.id);
    vendorIds.add(vendorId);
  };

  for (const { products } of samplerVendors) {
    if (picks.length >= limit) break;
    const next = products.find((candidate) => !productIds.has(candidate.id));
    if (next) add(next, 'store_sampler');
  }
  for (const product of forYou) {
    if (picks.length >= limit) break;
    add(product, 'for_you');
  }
  return picks;
}

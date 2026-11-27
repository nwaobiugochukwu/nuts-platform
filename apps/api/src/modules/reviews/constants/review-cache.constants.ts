export const PRODUCT_REVIEWS_CACHE_PREFIX = 'product:reviews:';

/** Both generations of the cached review list for a product. */
export function productReviewsCacheKeys(productId: string): string[] {
  return [
    `${PRODUCT_REVIEWS_CACHE_PREFIX}${productId}`,
    `${PRODUCT_REVIEWS_CACHE_PREFIX}${productId}:v2`,
  ];
}

/**
 * Identifies campaigns and coupons that are explicitly reserved for first-time shoppers who have never
 * placed an order before.
 */
export function isFirstOrderOnlyDiscount(discount: {
  firstOrderOnly?: boolean;
}): boolean {
  return discount.firstOrderOnly === true;
}

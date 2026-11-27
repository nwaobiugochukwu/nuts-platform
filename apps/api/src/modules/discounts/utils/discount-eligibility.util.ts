import { type DiscountCode, DiscountCodeScope, Prisma } from '@prisma/client';

/**
 * One cart/order line as seen by the discount engine.
 *
 * `categoryIds` must contain the product's category AND its parent category
 * (when it has one) so that a code targeting a top-level category also covers
 * products filed under one of its sub-categories.
 */
export interface DiscountLineItem {
  productId: string;
  vendorId: string;
  categoryIds: string[];
  lineTotal: Prisma.Decimal;
  /** Units on the line; used by quantity targets ("buy 3"). Defaults to 1. */
  quantity?: number;
}

export type DiscountEligibilityCode = Pick<
  DiscountCode,
  | 'scope'
  | 'vendorId'
  | 'platformwide'
  | 'applicableProductIds'
  | 'applicableCategoryIds'
>;

export interface DiscountEvaluation {
  /** Sum of the lines this code is allowed to discount. */
  eligibleSubtotal: Prisma.Decimal;
  /** Product ids of the eligible lines (used for diagnostics and receipts). */
  eligibleProductIds: string[];
}

/**
 * Single source of truth for "does this code cover this line?".
 *
 * Storefront deal badges, the cart preview and checkout ALL use this so the
 * price a shopper is shown is always the price they are charged.
 *
 * Rules:
 *  1. A vendor-scoped code only ever covers that vendor's own products.
 *  2. A code with a product and/or category list (and not flagged
 *     platform-wide) covers a line if its product OR any of its categories is
 *     listed.
 *  3. Otherwise it covers every line permitted by rule 1.
 */
export function isLineEligible(
  code: DiscountEligibilityCode,
  line: Pick<DiscountLineItem, 'productId' | 'vendorId' | 'categoryIds'>,
): boolean {
  if (
    (code.scope === DiscountCodeScope.VENDOR || code.vendorId) &&
    line.vendorId !== code.vendorId
  ) {
    return false;
  }

  const hasProductList = code.applicableProductIds.length > 0;
  const hasCategoryList = code.applicableCategoryIds.length > 0;
  const restricted = !code.platformwide && (hasProductList || hasCategoryList);
  if (!restricted) return true;

  if (hasProductList && code.applicableProductIds.includes(line.productId)) {
    return true;
  }
  return (
    hasCategoryList &&
    line.categoryIds.some((id) => code.applicableCategoryIds.includes(id))
  );
}

export function evaluateEligibleLines(
  code: DiscountEligibilityCode,
  lines: DiscountLineItem[],
): DiscountEvaluation {
  let eligibleSubtotal = new Prisma.Decimal(0);
  const eligibleProductIds: string[] = [];

  for (const line of lines) {
    if (!isLineEligible(code, line)) continue;
    eligibleSubtotal = eligibleSubtotal.add(line.lineTotal);
    eligibleProductIds.push(line.productId);
  }

  return {
    eligibleSubtotal: eligibleSubtotal.toDecimalPlaces(2),
    eligibleProductIds,
  };
}

/**
 * Whether a code can be shown/applied for a single product (storefront deal
 * badges). Same rules as checkout, applied to a one-line "cart".
 */
export function isProductEligible(
  code: DiscountEligibilityCode,
  product: { id: string; vendorId: string; categoryIds: string[] },
): boolean {
  return isLineEligible(code, {
    productId: product.id,
    vendorId: product.vendorId,
    categoryIds: product.categoryIds,
  });
}

/** At most one store voucher + one platform voucher per order. */
export const MAX_STACKED_VOUCHERS = 2;

/**
 * Spreads `discount` across the given lines in proportion to what each still
 * costs, mutating `remaining`. The last line absorbs the rounding remainder so
 * the allocations always sum to exactly `discount`.
 *
 * Tracking what is left per line is what lets a second voucher discount only
 * what the first one did not already take off.
 */
export function allocateAcrossLines(
  remaining: Prisma.Decimal[],
  lineIndexes: number[],
  discount: Prisma.Decimal,
): void {
  if (lineIndexes.length === 0 || discount.lessThanOrEqualTo(0)) return;
  const base = lineIndexes.reduce(
    (sum, i) => sum.add(remaining[i]),
    new Prisma.Decimal(0),
  );
  if (base.lessThanOrEqualTo(0)) return;

  let allocated = new Prisma.Decimal(0);
  lineIndexes.forEach((lineIndex, position) => {
    const isLast = position === lineIndexes.length - 1;
    const share = isLast
      ? discount.sub(allocated)
      : discount.mul(remaining[lineIndex]).div(base).toDecimalPlaces(2);
    const take = Prisma.Decimal.min(share, remaining[lineIndex]);
    remaining[lineIndex] = remaining[lineIndex].sub(take);
    allocated = allocated.add(take);
  });
}

/** Indexes of the lines a code is allowed to discount. */
export function eligibleLineIndexes(
  code: DiscountEligibilityCode,
  lines: DiscountLineItem[],
): number[] {
  const indexes: number[] = [];
  lines.forEach((line, index) => {
    if (isLineEligible(code, line)) indexes.push(index);
  });
  return indexes;
}

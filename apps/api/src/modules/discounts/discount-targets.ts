import type { PrismaService } from '@api/infrastructure/prisma/prisma.service';

/**
 * Human-facing description of what a voucher covers, so storefronts can say
 * "Applies to: <product>" and link to it instead of leaving a shopper with a
 * claimed code that silently does nothing.
 */
export interface DiscountTargets {
  /**
   * ALL        every product on the marketplace
   * STORE      every product of one store
   * PRODUCTS   specific products (and possibly categories)
   * CATEGORIES specific categories
   */
  kind: 'ALL' | 'STORE' | 'PRODUCTS' | 'CATEGORIES';
  store: { name: string; slug: string } | null;
  /** Up to MAX_LISTED products, in the order the vendor listed them. */
  products: Array<{ id: string; name: string; slug: string }>;
  /** Total targeted products still on sale (may exceed `products.length`). */
  productCount: number;
  categories: Array<{ id: string; name: string; slug: string }>;
}

export type TargetableDiscount = {
  vendorId: string | null;
  platformwide: boolean;
  applicableProductIds: string[];
  applicableCategoryIds: string[];
};

const MAX_LISTED = 6;

export function isRestrictedDiscount(code: TargetableDiscount): boolean {
  return (
    !code.platformwide &&
    (code.applicableProductIds.length > 0 ||
      code.applicableCategoryIds.length > 0)
  );
}

/** One batched lookup for any number of codes; result is aligned to `codes`. */
export async function describeDiscountTargets(
  prisma: Pick<PrismaService, 'vendor' | 'product' | 'category'>,
  codes: TargetableDiscount[],
): Promise<DiscountTargets[]> {
  const vendorIds = [
    ...new Set(codes.map((c) => c.vendorId).filter((v): v is string => !!v)),
  ];
  const restricted = codes.filter(isRestrictedDiscount);
  const productIds = [
    ...new Set(restricted.flatMap((c) => c.applicableProductIds)),
  ];
  const categoryIds = [
    ...new Set(restricted.flatMap((c) => c.applicableCategoryIds)),
  ];

  const [vendors, products, categories] = await Promise.all([
    vendorIds.length
      ? prisma.vendor.findMany({
          where: { id: { in: vendorIds } },
          select: { id: true, storeName: true, storeSlug: true },
        })
      : [],
    productIds.length
      ? prisma.product.findMany({
          where: { id: { in: productIds }, isActive: true, isDeleted: false },
          select: { id: true, name: true, slug: true },
        })
      : [],
    categoryIds.length
      ? prisma.category.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true, slug: true },
        })
      : [],
  ]);

  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return codes.map((code) => {
    const vendor = code.vendorId ? vendorById.get(code.vendorId) : undefined;
    const store = vendor
      ? { name: vendor.storeName, slug: vendor.storeSlug }
      : null;

    if (!isRestrictedDiscount(code)) {
      return {
        kind: code.vendorId ? 'STORE' : 'ALL',
        store,
        products: [],
        productCount: 0,
        categories: [],
      };
    }

    const targetedProducts = code.applicableProductIds
      .map((id) => productById.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);
    const targetedCategories = code.applicableCategoryIds
      .map((id) => categoryById.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c);

    return {
      kind: code.applicableProductIds.length === 0 ? 'CATEGORIES' : 'PRODUCTS',
      store,
      products: targetedProducts.slice(0, MAX_LISTED),
      productCount: targetedProducts.length,
      categories: targetedCategories,
    };
  });
}

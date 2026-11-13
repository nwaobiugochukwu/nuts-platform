import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { ProductsService } from '@api/modules/products/products.service';
import { getStockStatus } from '@api/common/utils/stock-status.util';

const PURCHASE_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

const RECOMMENDATION_LIMIT = 12;
const PERSONALIZED_RECOMMENDATION_POOL_LIMIT = 24;
const MARKETPLACE_MIX_VENDOR_LIMIT = 12;
const MARKETPLACE_MIX_PRODUCT_LIMIT = 12;
const MARKETPLACE_MIX_MAX_PRODUCTS_PER_VENDOR = 1;
const MARKETPLACE_MIX_POOL_LIMIT = 160;
const SEARCH_DISCOVERY_PRODUCT_LIMIT = 8;
const SEARCH_DISCOVERY_VENDOR_LIMIT = 4;
const SEARCH_DISCOVERY_POOL_LIMIT = 160;
const HISTORY_DAYS = 180;
const EXPOSURE_SUPPRESSION_DAYS = 14;
const RECENT_IMPRESSION_SCORE_PENALTY = 3.5;
const AVAILABLE_PRODUCT: Prisma.ProductWhereInput = {
  OR: [
    { stock: { gt: 0 } },
    {
      variants: {
        some: { isActive: true, isDeleted: false, stock: { gt: 0 } },
      },
    },
  ],
};

type CandidateProduct = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  vendorId: string;
  createdAt: Date;
  category: { name: string };
};

type MarketplaceMixCandidate = {
  id: string;
  categoryId: string;
  vendorId: string;
  createdAt: Date;
};

type SearchDiscoveryCandidate = Omit<MarketplaceMixCandidate, 'createdAt'>;

type MarketplaceMixVendor = {
  id: string;
  storeName: string;
  storeSlug: string;
  storeDescription: string;
  storeLogoUrl: string | null;
  isVerified: boolean;
};

type ScoredProduct = { id: string; score: number; product: CandidateProduct };

function addWeight(target: Map<string, number>, id: string, amount: number) {
  target.set(id, (target.get(id) ?? 0) + amount);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function stableUuidCursor(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function searchTokens(queries: string[], minimumTokenLength = 3) {
  const weights = new Map<string, number>();
  for (const [index, query] of queries.entries()) {
    const recencyWeight = Math.pow(0.78, index);
    const tokens = query
      .toLocaleLowerCase()
      .normalize('NFKC')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= minimumTokenLength)
      .slice(0, 5);
    for (const token of new Set(tokens)) {
      addWeight(weights, token, recencyWeight);
    }
  }
  return weights;
}

function scoreAndDiversify(
  candidates: CandidateProduct[],
  excludedIds: Set<string>,
  categoryWeights: Map<string, number>,
  vendorWeights: Map<string, number>,
  searchWeights: Map<string, number>,
  coPurchaseScores: Map<string, number>,
  limit = RECOMMENDATION_LIMIT,
  recentlyImpressedIds: Set<string> = new Set(),
) {
  const now = Date.now();
  const scored: ScoredProduct[] = candidates
    .filter((product) => !excludedIds.has(product.id))
    .map((product) => {
      const searchableText =
        `${product.name} ${product.description ?? ''} ${product.category.name}`
          .toLocaleLowerCase()
          .normalize('NFKC');
      const searchableTokens = new Set(
        searchableText.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
      );
      let searchScore = 0;
      for (const [token, weight] of searchWeights) {
        if (searchableTokens.has(token)) searchScore += weight * 2.5;
      }
      const ageDays = Math.max(
        0,
        (now - product.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      const recencyScore = Math.max(0, 1 - ageDays / 120);
      const score =
        (coPurchaseScores.get(product.id) ?? 0) +
        Math.min(15, (categoryWeights.get(product.categoryId) ?? 0) * 2.2) +
        Math.min(6, (vendorWeights.get(product.vendorId) ?? 0) * 0.55) +
        searchScore +
        recencyScore -
        (recentlyImpressedIds.has(product.id)
          ? RECENT_IMPRESSION_SCORE_PENALTY
          : 0);
      return { id: product.id, score, product };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.product.createdAt.getTime() - a.product.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );

  // Limit repeated stores and categories so one strong signal cannot dominate
  // the whole shelf. If the catalog is too small, fill remaining slots after.
  const selected: ScoredProduct[] = [];
  const selectedIds = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const vendorCounts = new Map<string, number>();

  for (const product of scored) {
    if (
      (categoryCounts.get(product.product.categoryId) ?? 0) >= 4 ||
      (vendorCounts.get(product.product.vendorId) ?? 0) >= 3
    ) {
      continue;
    }
    selected.push(product);
    selectedIds.add(product.id);
    categoryCounts.set(
      product.product.categoryId,
      (categoryCounts.get(product.product.categoryId) ?? 0) + 1,
    );
    vendorCounts.set(
      product.product.vendorId,
      (vendorCounts.get(product.product.vendorId) ?? 0) + 1,
    );
    if (selected.length === limit) break;
  }

  if (selected.length < limit) {
    for (const product of scored) {
      if (selectedIds.has(product.id)) continue;
      selected.push(product);
      if (selected.length === limit) break;
    }
  }
  return selected.map(({ id }) => id);
}

function explainRecommendation(
  candidate: CandidateProduct,
  coPurchaseScores: Map<string, number>,
  followedVendorIds: Set<string>,
  categoryWeights: Map<string, number>,
  vendorWeights: Map<string, number>,
  searchWeights: Map<string, number>,
): string {
  if ((coPurchaseScores.get(candidate.id) ?? 0) > 0) {
    return 'Often bought alongside products you purchased';
  }
  if (followedVendorIds.has(candidate.vendorId))
    return 'From a store you follow';
  const tokens = new Set(
    `${candidate.name} ${candidate.description ?? ''} ${candidate.category.name}`
      .toLocaleLowerCase()
      .normalize('NFKC')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
  if ([...searchWeights.keys()].some((token) => tokens.has(token))) {
    return 'Matches your recent searches';
  }
  if (categoryWeights.has(candidate.categoryId)) {
    return `Based on your interest in ${candidate.category.name}`;
  }
  if (vendorWeights.has(candidate.vendorId))
    return 'From a store you have explored';
  return 'A recent pick based on your shopping activity';
}

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async discover() {
    const trending = await this.products.findTrending({ limit: 50, days: 30 });
    return trending.slice(0, RECOMMENDATION_LIMIT);
  }

  async searchDiscover(
    userId?: string,
    sessionId?: string,
    visitorId?: string,
  ) {
    const actorId = userId ?? visitorId ?? sessionId;
    if (!actorId) return { items: [] };

    const availableWhere: Prisma.ProductWhereInput = {
      isActive: true,
      isDeleted: false,
      category: { is: { isActive: true } },
      vendor: { isActive: true, isApproved: true },
      ...AVAILABLE_PRODUCT,
    };
    const guestIds = [
      ...new Set(
        [visitorId, sessionId].filter((id): id is string => Boolean(id)),
      ),
    ];
    const historyStart = new Date(
      Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000,
    );
    const historyWhere: Prisma.RecentProductViewWhereInput = userId
      ? {
          OR: [
            { userId },
            ...(guestIds.length ? [{ visitorId: { in: guestIds } }] : []),
          ],
          lastViewedAt: { gte: historyStart },
        }
      : {
          visitorId: { in: guestIds.length ? guestIds : [actorId] },
          lastViewedAt: { gte: historyStart },
        };

    const [recentViews, discoveredStores] = await Promise.all([
      this.prisma.recentProductView.findMany({
        where: historyWhere,
        orderBy: [{ lastViewedAt: 'desc' }, { id: 'asc' }],
        take: 40,
        select: {
          productId: true,
          product: { select: { categoryId: true, vendorId: true } },
        },
      }),
      this.discoverStores(userId, sessionId, visitorId),
    ]);

    const viewedProductIds = [
      ...new Set(recentViews.map(({ productId }) => productId)),
    ];
    const categoryWeights = new Map<string, number>();
    const vendorWeights = new Map<string, number>();
    recentViews.forEach(({ product }, index) => {
      const weight = Math.pow(0.84, index);
      addWeight(categoryWeights, product.categoryId, weight);
      addWeight(vendorWeights, product.vendorId, weight);
    });

    const signalConditions: Prisma.ProductWhereInput[] = [];
    if (categoryWeights.size)
      signalConditions.push({
        categoryId: { in: [...categoryWeights.keys()] },
      });
    if (vendorWeights.size)
      signalConditions.push({ vendorId: { in: [...vendorWeights.keys()] } });
    const notRecentlyViewed: Prisma.ProductWhereInput = viewedProductIds.length
      ? { id: { notIn: viewedProductIds } }
      : {};
    const matchingCandidates = signalConditions.length
      ? await this.prisma.product.findMany({
          where: {
            ...availableWhere,
            ...notRecentlyViewed,
            OR: signalConditions,
          },
          orderBy: { id: 'asc' },
          take: SEARCH_DISCOVERY_POOL_LIMIT,
          select: { id: true, categoryId: true, vendorId: true },
        })
      : [];

    const fallbackWhere: Prisma.ProductWhereInput = {
      ...availableWhere,
      ...notRecentlyViewed,
    };
    const dayKey = new Date().toISOString().slice(0, 10);
    const cursorId = stableUuidCursor(`${actorId}:search-discover:${dayKey}`);
    const sampleCircularCandidates = async (
      where: Prisma.ProductWhereInput,
    ) => {
      const tail = await this.prisma.product.findMany({
        where: { AND: [where, { id: { gte: cursorId } }] },
        orderBy: { id: 'asc' },
        take: SEARCH_DISCOVERY_POOL_LIMIT,
        select: { id: true, categoryId: true, vendorId: true },
      });
      const remaining = SEARCH_DISCOVERY_POOL_LIMIT - tail.length;
      const head =
        remaining > 0
          ? await this.prisma.product.findMany({
              where: { AND: [where, { id: { lt: cursorId } }] },
              orderBy: { id: 'asc' },
              take: remaining,
              select: { id: true, categoryId: true, vendorId: true },
            })
          : [];
      return [...tail, ...head];
    };
    let fallbackCandidates = await sampleCircularCandidates(fallbackWhere);
    // If the shopper has already viewed every eligible item, allow those
    // products back into the bounded candidate pool.
    if (fallbackCandidates.length === 0 && viewedProductIds.length > 0) {
      fallbackCandidates = await sampleCircularCandidates(availableWhere);
    }

    const candidateById = new Map<string, SearchDiscoveryCandidate>();
    for (const candidate of [...matchingCandidates, ...fallbackCandidates]) {
      candidateById.set(candidate.id, candidate);
    }
    const candidates = [...candidateById.values()]
      .map((candidate) => ({
        ...candidate,
        score:
          (categoryWeights.get(candidate.categoryId) ?? 0) * 4 +
          (vendorWeights.get(candidate.vendorId) ?? 0) * 1.5 +
          (stableHash(`${actorId}:${dayKey}:${candidate.id}`) / 0xffffffff) *
            0.2,
      }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const selectedProducts: typeof candidates = [];
    const selectedProductIds = new Set<string>();
    const selectedVendorCounts = new Map<string, number>();
    const selectedCategoryCounts = new Map<string, number>();
    const storeCandidates = discoveredStores.slice(
      0,
      SEARCH_DISCOVERY_VENDOR_LIMIT,
    );
    const storePreviewIds = new Set(
      storeCandidates.flatMap((store) =>
        store.featuredProducts.slice(0, 2).map(({ id }) => id),
      ),
    );
    const addProductCandidate = (candidate: (typeof candidates)[number]) => {
      if (
        selectedProductIds.has(candidate.id) ||
        storePreviewIds.has(candidate.id)
      )
        return;
      selectedProducts.push(candidate);
      selectedProductIds.add(candidate.id);
      selectedVendorCounts.set(
        candidate.vendorId,
        (selectedVendorCounts.get(candidate.vendorId) ?? 0) + 1,
      );
      selectedCategoryCounts.set(
        candidate.categoryId,
        (selectedCategoryCounts.get(candidate.categoryId) ?? 0) + 1,
      );
    };

    for (const candidate of candidates) {
      if (selectedProducts.length >= SEARCH_DISCOVERY_PRODUCT_LIMIT) break;
      if (
        (selectedVendorCounts.get(candidate.vendorId) ?? 0) >= 2 ||
        (selectedCategoryCounts.get(candidate.categoryId) ?? 0) >= 2
      )
        continue;
      addProductCandidate(candidate);
    }
    for (const candidate of candidates) {
      if (selectedProducts.length >= SEARCH_DISCOVERY_PRODUCT_LIMIT) break;
      if (
        (selectedVendorCounts.get(candidate.vendorId) ?? 0) >= 3 ||
        (selectedCategoryCounts.get(candidate.categoryId) ?? 0) >= 3
      )
        continue;
      addProductCandidate(candidate);
    }
    for (const candidate of candidates) {
      if (selectedProducts.length >= SEARCH_DISCOVERY_PRODUCT_LIMIT) break;
      addProductCandidate(candidate);
    }

    const [productCards, previewCards] = await Promise.all([
      this.products.findPublicCardsByIds(
        selectedProducts.map(({ id }) => id),
        true,
      ),
      this.products.findPublicCardsByIds([...storePreviewIds], true),
    ]);
    const productCardsById = new Map(
      productCards.map((product) => [product.id, product]),
    );
    const previewCardsById = new Map(
      previewCards.map((product) => [product.id, product]),
    );
    const productItems = selectedProducts.flatMap((candidate) => {
      const product = productCardsById.get(candidate.id);
      if (!product) return [];
      const reason = categoryWeights.has(candidate.categoryId)
        ? 'Related to products you viewed'
        : vendorWeights.has(candidate.vendorId)
          ? 'More from a store you explored'
          : 'A pick from across NUTS';
      return [{ type: 'product' as const, product, reason }];
    });
    const vendorItems = storeCandidates.flatMap((store) => {
      const products = store.featuredProducts.slice(0, 2).flatMap(({ id }) => {
        const product = previewCardsById.get(id);
        return product ? [product] : [];
      });
      if (products.length === 0) return [];
      return [
        {
          type: 'vendor' as const,
          vendor: {
            id: store.id,
            storeName: store.storeName,
            storeSlug: store.storeSlug,
            storeDescription: store.storeDescription,
            storeLogoUrl: store.storeLogoUrl,
            isVerified: store.isVerified,
          },
          products,
          reason: categoryWeights.size
            ? 'Related to your recent browsing'
            : 'A store worth exploring',
        },
      ];
    });

    const items: Array<
      (typeof productItems)[number] | (typeof vendorItems)[number]
    > = [];
    let productIndex = 0;
    let vendorIndex = 0;
    while (
      items.length <
        SEARCH_DISCOVERY_PRODUCT_LIMIT + SEARCH_DISCOVERY_VENDOR_LIMIT &&
      (productIndex < productItems.length || vendorIndex < vendorItems.length)
    ) {
      if (productIndex < productItems.length)
        items.push(productItems[productIndex++]);
      if (productIndex < productItems.length)
        items.push(productItems[productIndex++]);
      if (vendorIndex < vendorItems.length)
        items.push(vendorItems[vendorIndex++]);
    }
    return { items };
  }

  async marketplaceMix(
    userId?: string,
    sessionId?: string,
    visitorId?: string,
  ) {
    const actorId = userId ?? visitorId ?? sessionId;
    if (!actorId) return { vendors: [] };

    const availableWhere: Prisma.ProductWhereInput = {
      isActive: true,
      isDeleted: false,
      category: { is: { isActive: true } },
      vendor: {
        is: {
          isActive: true,
          isApproved: true,
          ...(userId ? { follows: { none: { userId } } } : {}),
        },
      },
      images: { some: {} },
      ...AVAILABLE_PRODUCT,
    };
    const mixWhere: Prisma.ProductWhereInput = availableWhere;

    // Sample a different circular slice of inventory per shopper and day.
    // Recency gets a modest boost, while category and vendor constraints keep
    // new listings from crowding out the rest of the marketplace.
    const dayKey = new Date().toISOString().slice(0, 10);
    const cursorId = stableUuidCursor(`${actorId}:${dayKey}`);
    const tail = await this.prisma.product.findMany({
      where: { AND: [mixWhere, { id: { gte: cursorId } }] },
      orderBy: { id: 'asc' },
      take: MARKETPLACE_MIX_POOL_LIMIT,
      select: { id: true, categoryId: true, vendorId: true, createdAt: true },
    });
    const remaining = MARKETPLACE_MIX_POOL_LIMIT - tail.length;
    const head =
      remaining > 0
        ? await this.prisma.product.findMany({
            where: { AND: [mixWhere, { id: { lt: cursorId } }] },
            orderBy: { id: 'asc' },
            take: remaining,
            select: {
              id: true,
              categoryId: true,
              vendorId: true,
              createdAt: true,
            },
          })
        : [];
    const candidates: MarketplaceMixCandidate[] = [...tail, ...head];
    const now = Date.now();
    const rankedCandidates = candidates
      .map((candidate) => {
        const ageDays = Math.max(
          0,
          (now - candidate.createdAt.getTime()) / (24 * 60 * 60 * 1000),
        );
        const freshnessScore = Math.max(0, 1 - ageDays / 120);
        const rotationScore =
          stableHash(`${actorId}:${dayKey}:${candidate.vendorId}`) / 0xffffffff;
        return { candidate, score: rotationScore + freshnessScore * 0.25 };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.candidate.createdAt.getTime() - a.candidate.createdAt.getTime(),
      )
      .map(({ candidate }) => candidate);
    const selectedVendorIds: string[] = [];
    const selectedVendorIdSet = new Set<string>();
    const selectedCategories = new Set<string>();
    for (const candidate of rankedCandidates) {
      if (selectedVendorIds.length >= MARKETPLACE_MIX_VENDOR_LIMIT) break;
      if (
        selectedVendorIdSet.has(candidate.vendorId) ||
        selectedCategories.has(candidate.categoryId)
      )
        continue;
      selectedVendorIds.push(candidate.vendorId);
      selectedVendorIdSet.add(candidate.vendorId);
      selectedCategories.add(candidate.categoryId);
    }
    for (const candidate of rankedCandidates) {
      if (selectedVendorIds.length >= MARKETPLACE_MIX_VENDOR_LIMIT) break;
      if (selectedVendorIdSet.has(candidate.vendorId)) continue;
      selectedVendorIds.push(candidate.vendorId);
      selectedVendorIdSet.add(candidate.vendorId);
    }

    if (selectedVendorIds.length < MARKETPLACE_MIX_VENDOR_LIMIT) {
      const remainingVendors = await this.prisma.vendor.findMany({
        where: {
          isActive: true,
          isApproved: true,
          ...(userId ? { follows: { none: { userId } } } : {}),
          ...(selectedVendorIds.length
            ? { id: { notIn: selectedVendorIds } }
            : {}),
          products: {
            some: {
              isActive: true,
              isDeleted: false,
              category: { is: { isActive: true } },
              images: { some: {} },
              ...AVAILABLE_PRODUCT,
            },
          },
        },
        orderBy: [{ isVerified: 'desc' }, { createdAt: 'desc' }],
        take: MARKETPLACE_MIX_VENDOR_LIMIT - selectedVendorIds.length,
        select: { id: true },
      });
      selectedVendorIds.push(...remainingVendors.map(({ id }) => id));
    }

    if (selectedVendorIds.length === 0) return { vendors: [] };

    const vendorRows = await this.prisma.vendor.findMany({
      where: {
        id: { in: selectedVendorIds },
        isActive: true,
        isApproved: true,
      },
      select: {
        id: true,
        storeName: true,
        storeSlug: true,
        storeDescription: true,
        storeLogoUrl: true,
        isVerified: true,
      },
    });
    const vendorsById = new Map<string, MarketplaceMixVendor>(
      vendorRows.map((vendor) => [vendor.id, vendor]),
    );
    const vendorIds = selectedVendorIds.filter((id) => vendorsById.has(id));
    if (vendorIds.length === 0) return { vendors: [] };

    const productSlots = Math.min(
      MARKETPLACE_MIX_PRODUCT_LIMIT,
      vendorIds.length * MARKETPLACE_MIX_MAX_PRODUCTS_PER_VENDOR,
    );
    const baseSlotsPerVendor = Math.floor(productSlots / vendorIds.length);
    const extraSlots = productSlots % vendorIds.length;
    const productSelections = await Promise.all(
      vendorIds.map(async (vendorId, index) => {
        const vendorProductWhere: Prisma.ProductWhereInput = {
          ...availableWhere,
          vendorId,
        };
        const productLimit = baseSlotsPerVendor + (index < extraSlots ? 1 : 0);
        const recentProducts = await this.prisma.product.findMany({
          where: vendorProductWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: Math.max(productLimit, 8),
          select: { id: true },
        });
        if (!recentProducts.length) return { vendorId, productIds: [] };
        const selectedProductIds: string[] = [];
        const productOffset =
          stableHash(`${actorId}:${dayKey}:${vendorId}`) %
          recentProducts.length;
        for (
          let position = 0;
          position < Math.min(productLimit, recentProducts.length);
          position += 1
        ) {
          selectedProductIds.push(
            recentProducts[(productOffset + position) % recentProducts.length]
              .id,
          );
        }
        return { vendorId, productIds: selectedProductIds };
      }),
    );
    const productIds = productSelections.flatMap(
      ({ productIds }) => productIds,
    );
    const productCards = productIds.length
      ? await this.products.findPublicCardsByIds(productIds, true)
      : [];
    const productCardsById = new Map(
      productCards.map((product) => [product.id, product]),
    );
    const vendors = productSelections.flatMap(({ vendorId, productIds }) => {
      const vendor = vendorsById.get(vendorId);
      if (!vendor) return [];
      const products = productIds.flatMap((id) => {
        const product = productCardsById.get(id);
        return product ? [product] : [];
      });
      return products.length ? [{ vendor, products }] : [];
    });

    return {
      vendors,
    };
  }

  async forYou(userId?: string, sessionId?: string, visitorId?: string) {
    const historyStart = new Date(
      Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000,
    );
    const guestHistoryIds = [
      ...new Set(
        [visitorId, sessionId].filter((id): id is string => Boolean(id)),
      ),
    ];
    const recentHistoryWhere: Prisma.RecentProductViewWhereInput = userId
      ? {
          OR: [
            { userId },
            ...(guestHistoryIds.length
              ? [{ visitorId: { in: guestHistoryIds } }]
              : []),
          ],
          lastViewedAt: { gte: historyStart },
        }
      : {
          visitorId: { in: guestHistoryIds },
          lastViewedAt: { gte: historyStart },
        };
    const activityActor = userId
      ? {
          OR: [{ userId }, ...(sessionId ? [{ userId: null, sessionId }] : [])],
        }
      : { userId: null, sessionId: sessionId ?? '__no_session__' };
    const [
      views,
      durableViews,
      purchases,
      wishlist,
      cartItems,
      searches,
      clicks,
      recentImpressions,
      follows,
      categoryViews,
      vendorClicks,
    ] = await Promise.all([
      this.prisma.productView.findMany({
        where: { ...activityActor, createdAt: { gte: historyStart } },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: { productId: true, createdAt: true },
      }),
      this.prisma.recentProductView.findMany({
        where: recentHistoryWhere,
        orderBy: { lastViewedAt: 'desc' },
        take: 60,
        select: { productId: true, lastViewedAt: true },
      }),
      userId
        ? this.prisma.orderItem.findMany({
            where: {
              order: {
                userId,
                status: { in: PURCHASE_STATUSES },
                createdAt: { gte: historyStart },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: { productId: true, quantity: true },
          })
        : Promise.resolve([]),
      userId
        ? this.prisma.wishlistItem.findMany({
            where: { userId, createdAt: { gte: historyStart } },
            orderBy: { createdAt: 'desc' },
            take: 40,
            select: { productId: true },
          })
        : Promise.resolve([]),
      userId
        ? this.prisma.cartItem.findMany({
            where: { cart: { userId, checkedOut: false } },
            orderBy: { updatedAt: 'desc' },
            take: 40,
            select: { productId: true, quantity: true },
          })
        : Promise.resolve([]),
      this.prisma.searchQuery.findMany({
        where: userId
          ? {
              OR: [
                { userId },
                ...(sessionId ? [{ userId: null, sessionId }] : []),
              ],
              createdAt: { gte: historyStart },
            }
          : {
              userId: null,
              sessionId: sessionId ?? '__no_session__',
              createdAt: { gte: historyStart },
            },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { query: true },
      }),
      this.prisma.recommendationEvent.findMany({
        where: {
          ...activityActor,
          eventType: 'CLICK',
          productId: { not: null },
          createdAt: { gte: historyStart },
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: { productId: true, createdAt: true },
      }),
      this.prisma.recommendationEvent.findMany({
        where: {
          ...activityActor,
          eventType: 'IMPRESSION',
          surface: 'HOME_FOR_YOU',
          productId: { not: null },
          createdAt: {
            gte: new Date(
              Date.now() - EXPOSURE_SUPPRESSION_DAYS * 24 * 60 * 60 * 1000,
            ),
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { productId: true },
      }),
      userId
        ? this.prisma.vendorFollow.findMany({
            where: { userId, vendor: { isActive: true, isApproved: true } },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: { vendorId: true },
          })
        : Promise.resolve([]),
      this.prisma.recommendationEvent.findMany({
        where: {
          ...activityActor,
          eventType: 'CATEGORY_VIEW',
          categoryId: { not: null },
          createdAt: { gte: historyStart },
        },
        orderBy: { createdAt: 'desc' },
        take: 60,
        select: { categoryId: true, createdAt: true },
      }),
      this.prisma.recommendationEvent.findMany({
        where: {
          ...activityActor,
          eventType: 'CLICK',
          productId: null,
          vendorId: { not: null },
          createdAt: { gte: historyStart },
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: { vendorId: true, createdAt: true },
      }),
    ]);

    // The durable recent-view record is written before the analytics buffer is
    // flushed. Merge it with legacy ProductView rows so fresh browsing affects
    // recommendations immediately, without counting the same product twice.
    const viewActivityByProduct = new Map<string, Date>();
    for (const view of views) {
      const existing = viewActivityByProduct.get(view.productId);
      if (!existing || view.createdAt > existing) {
        viewActivityByProduct.set(view.productId, view.createdAt);
      }
    }
    for (const view of durableViews) {
      const existing = viewActivityByProduct.get(view.productId);
      if (!existing || view.lastViewedAt > existing) {
        viewActivityByProduct.set(view.productId, view.lastViewedAt);
      }
    }
    const recentViewSignals = [...viewActivityByProduct.entries()]
      .sort((a, b) => b[1].getTime() - a[1].getTime())
      .slice(0, 60)
      .map(([productId, createdAt]) => ({ productId, createdAt }));

    const seedWeights = new Map<string, number>();
    for (const purchase of purchases) {
      addWeight(
        seedWeights,
        purchase.productId,
        9 + Math.min(3, Math.log2(Math.max(1, purchase.quantity))),
      );
    }
    for (const item of cartItems) {
      addWeight(
        seedWeights,
        item.productId,
        7 + Math.min(2, item.quantity / 3),
      );
    }
    for (const item of wishlist) addWeight(seedWeights, item.productId, 6);
    for (const [index, click] of clicks.entries()) {
      if (!click.productId) continue;
      const ageDays = Math.max(
        0,
        (Date.now() - click.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      addWeight(
        seedWeights,
        click.productId,
        Math.max(1, 4 * Math.exp(-ageDays / 35)) * Math.pow(0.97, index),
      );
    }
    for (const [index, view] of recentViewSignals.entries()) {
      const ageDays = Math.max(
        0,
        (Date.now() - view.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      addWeight(
        seedWeights,
        view.productId,
        Math.max(0.25, 2.5 * Math.exp(-ageDays / 45)) * Math.pow(0.98, index),
      );
    }

    const seedIds = [...seedWeights.keys()];
    const viewedSeedIds = new Set(seedIds);
    const recentImpressionIds = new Set(
      recentImpressions.flatMap(({ productId }) =>
        productId ? [productId] : [],
      ),
    );
    const suppressedIds = [...new Set([...seedIds, ...recentImpressionIds])];
    const searchWeights = searchTokens(searches.map(({ query }) => query));
    if (
      seedIds.length === 0 &&
      searchWeights.size === 0 &&
      follows.length === 0 &&
      categoryViews.length === 0 &&
      vendorClicks.length === 0
    ) {
      return [];
    }

    const seedProducts = seedIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: seedIds } },
          select: { id: true, categoryId: true, vendorId: true },
        })
      : [];
    const categoryWeights = new Map<string, number>();
    const vendorWeights = new Map<string, number>();
    for (const product of seedProducts) {
      const weight = seedWeights.get(product.id) ?? 0;
      addWeight(categoryWeights, product.categoryId, weight);
      addWeight(vendorWeights, product.vendorId, weight);
    }
    for (const [index, event] of categoryViews.entries()) {
      if (!event.categoryId) continue;
      const ageDays = Math.max(
        0,
        (Date.now() - event.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      addWeight(
        categoryWeights,
        event.categoryId,
        Math.max(1, 4 * Math.exp(-ageDays / 45)) * Math.pow(0.96, index),
      );
    }
    for (const follow of follows)
      addWeight(vendorWeights, follow.vendorId, 3.5);
    for (const [index, event] of vendorClicks.entries()) {
      if (!event.vendorId) continue;
      const ageDays = Math.max(
        0,
        (Date.now() - event.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
      addWeight(
        vendorWeights,
        event.vendorId,
        Math.max(1, 4 * Math.exp(-ageDays / 35)) * Math.pow(0.97, index),
      );
    }

    const purchasedSeedIds = [
      ...new Set(purchases.map(({ productId }) => productId)),
    ];
    const coPurchases = purchasedSeedIds.length
      ? await this.prisma.orderItem.groupBy({
          by: ['productId'],
          where: {
            productId: { notIn: suppressedIds },
            order: {
              status: { in: PURCHASE_STATUSES },
              orderItems: { some: { productId: { in: purchasedSeedIds } } },
            },
            product: {
              isActive: true,
              isDeleted: false,
              category: { is: { isActive: true } },
              vendor: { isActive: true, isApproved: true },
              ...AVAILABLE_PRODUCT,
            },
          },
          _sum: { quantity: true },
          _count: { _all: true },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 100,
        })
      : [];
    const coPurchaseScores = new Map(
      coPurchases.map((item) => [
        item.productId,
        Math.log1p(item._sum.quantity ?? 0) * 4 +
          Math.log1p(item._count._all) * 3,
      ]),
    );

    const interestConditions: Prisma.ProductWhereInput[] = [];
    if (categoryWeights.size > 0) {
      interestConditions.push({
        categoryId: { in: [...categoryWeights.keys()] },
      });
    }
    if (vendorWeights.size > 0) {
      interestConditions.push({ vendorId: { in: [...vendorWeights.keys()] } });
    }
    if (searchWeights.size > 0) {
      interestConditions.push(
        ...[...searchWeights.keys()].map((token) => ({
          OR: [
            { name: { contains: token, mode: 'insensitive' as const } },
            { description: { contains: token, mode: 'insensitive' as const } },
            {
              category: {
                is: { name: { contains: token, mode: 'insensitive' as const } },
              },
            },
          ],
        })),
      );
    }

    const contentCandidates = interestConditions.length
      ? await this.prisma.product.findMany({
          where: {
            id: { notIn: suppressedIds },
            isActive: true,
            isDeleted: false,
            category: { is: { isActive: true } },
            vendor: { isActive: true, isApproved: true },
            ...AVAILABLE_PRODUCT,
            AND: [{ OR: interestConditions }],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
          select: {
            id: true,
            name: true,
            description: true,
            categoryId: true,
            vendorId: true,
            createdAt: true,
            category: { select: { name: true } },
          },
        })
      : [];

    const candidateIds = [
      ...new Set([
        ...coPurchases.map(({ productId }) => productId),
        ...contentCandidates.map(({ id }) => id),
      ]),
    ].slice(0, 160);
    const candidates = candidateIds.length
      ? await this.prisma.product.findMany({
          where: {
            id: { in: candidateIds, notIn: suppressedIds },
            isActive: true,
            isDeleted: false,
            category: { is: { isActive: true } },
            vendor: { isActive: true, isApproved: true },
            ...AVAILABLE_PRODUCT,
          },
          select: {
            id: true,
            name: true,
            description: true,
            categoryId: true,
            vendorId: true,
            createdAt: true,
            category: { select: { name: true } },
          },
        })
      : [];

    const recommendationCandidateById = new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    );
    // Prefer products the shopper has not recently seen, but do not let
    // impression suppression empty the whole shelf in a small catalog.
    if (
      interestConditions.length > 0 &&
      recommendationCandidateById.size < PERSONALIZED_RECOMMENDATION_POOL_LIMIT
    ) {
      const repeatableCandidates = await this.prisma.product.findMany({
        where: {
          id: { notIn: seedIds },
          isActive: true,
          isDeleted: false,
          category: { is: { isActive: true } },
          vendor: { isActive: true, isApproved: true },
          ...AVAILABLE_PRODUCT,
          AND: [{ OR: interestConditions }],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          name: true,
          description: true,
          categoryId: true,
          vendorId: true,
          createdAt: true,
          category: { select: { name: true } },
        },
      });
      for (const candidate of repeatableCandidates) {
        recommendationCandidateById.set(candidate.id, candidate);
      }
    }
    const recommendationCandidates = [...recommendationCandidateById.values()];

    const freshRecommendationIds = scoreAndDiversify(
      recommendationCandidates,
      new Set([...viewedSeedIds, ...recentImpressionIds]),
      categoryWeights,
      vendorWeights,
      searchWeights,
      coPurchaseScores,
      PERSONALIZED_RECOMMENDATION_POOL_LIMIT,
    );
    const fallbackRecommendationIds =
      freshRecommendationIds.length < PERSONALIZED_RECOMMENDATION_POOL_LIMIT
        ? scoreAndDiversify(
            recommendationCandidates,
            new Set([...viewedSeedIds, ...freshRecommendationIds]),
            categoryWeights,
            vendorWeights,
            searchWeights,
            coPurchaseScores,
            PERSONALIZED_RECOMMENDATION_POOL_LIMIT -
              freshRecommendationIds.length,
            recentImpressionIds,
          )
        : [];
    const recommendedIds = [
      ...freshRecommendationIds,
      ...fallbackRecommendationIds,
    ];
    // Keep the shelf grounded in the shopper's signals. Previously exposed
    // related products may reappear with a score penalty when the catalog is
    // too small to supply a full unseen pool.
    const cards = await this.products.findPublicCardsByIds(
      recommendedIds,
      true,
    );
    const candidateById = new Map(
      recommendationCandidates.map((candidate) => [candidate.id, candidate]),
    );
    const followedVendorIds = new Set(follows.map(({ vendorId }) => vendorId));
    return cards.map((card) => {
      const candidate = candidateById.get(card.id);
      return candidate
        ? {
            ...card,
            recommendationReason: explainRecommendation(
              candidate,
              coPurchaseScores,
              followedVendorIds,
              categoryWeights,
              vendorWeights,
              searchWeights,
            ),
          }
        : card;
    });
  }

  async recentlyViewed(
    userId?: string,
    sessionId?: string,
    visitorId?: string,
  ) {
    if (!userId && !sessionId && !visitorId) return [];
    const historyStart = new Date(
      Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000,
    );
    const guestHistoryIds = [
      ...new Set(
        [visitorId, sessionId].filter((id): id is string => Boolean(id)),
      ),
    ];
    const historyScope: Prisma.RecentProductViewWhereInput = userId
      ? {
          OR: [
            { userId },
            ...(guestHistoryIds.length
              ? [{ visitorId: { in: guestHistoryIds } }]
              : []),
          ],
          lastViewedAt: { gte: historyStart },
        }
      : {
          visitorId: { in: guestHistoryIds },
          lastViewedAt: { gte: historyStart },
        };
    const legacyActor = userId
      ? {
          OR: [{ userId }, ...(sessionId ? [{ userId: null, sessionId }] : [])],
        }
      : { userId: null, sessionId };
    const [history, legacyViews] = await Promise.all([
      this.prisma.recentProductView.findMany({
        where: historyScope,
        orderBy: { lastViewedAt: 'desc' },
        take: 100,
        select: { productId: true, lastViewedAt: true },
      }),
      sessionId || userId
        ? this.prisma.productView.findMany({
            where: { ...legacyActor, createdAt: { gte: historyStart } },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: { productId: true, createdAt: true },
          })
        : Promise.resolve([]),
    ]);
    const latestByProduct = new Map<string, Date>();
    for (const view of [
      ...history,
      ...legacyViews.map(({ productId, createdAt }) => ({
        productId,
        lastViewedAt: createdAt,
      })),
    ]) {
      const existing = latestByProduct.get(view.productId);
      if (!existing || view.lastViewedAt > existing)
        latestByProduct.set(view.productId, view.lastViewedAt);
    }
    const uniqueIds = [...latestByProduct.entries()]
      .sort((a, b) => b[1].getTime() - a[1].getTime())
      .slice(0, 12)
      .map(([productId]) => productId);
    return this.products.findPublicCardsByIds(uniqueIds, true);
  }

  async claimRecentlyViewed(userId: string, visitorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const visitorViews = await tx.recentProductView.findMany({
        where: { visitorId },
        orderBy: { lastViewedAt: 'desc' },
        take: 100,
        select: { productId: true, lastViewedAt: true },
      });
      if (!visitorViews.length) return { claimed: 0 };

      const existingViews = await tx.recentProductView.findMany({
        where: {
          userId,
          productId: { in: visitorViews.map(({ productId }) => productId) },
        },
        select: { productId: true, lastViewedAt: true },
      });
      const existingByProduct = new Map(
        existingViews.map((view) => [view.productId, view.lastViewedAt]),
      );
      const toCreate = visitorViews
        .filter((view) => !existingByProduct.has(view.productId))
        .map((view) => ({
          userId,
          productId: view.productId,
          lastViewedAt: view.lastViewedAt,
        }));
      if (toCreate.length) {
        await tx.recentProductView.createMany({
          data: toCreate,
          skipDuplicates: true,
        });
      }

      const toAdvance = visitorViews.filter((view) => {
        const existing = existingByProduct.get(view.productId);
        return existing && view.lastViewedAt > existing;
      });
      for (const view of toAdvance) {
        await tx.recentProductView.updateMany({
          where: {
            userId,
            productId: view.productId,
            lastViewedAt: { lt: view.lastViewedAt },
          },
          data: { lastViewedAt: view.lastViewedAt },
        });
      }

      // Keep the visitor rows for a short retention window. A second tab or a
      // delayed guest event can still be claimed safely on the next hydration.
      return { claimed: visitorViews.length };
    });
  }

  async following(userId: string) {
    const [followed, recentImpressions] = await Promise.all([
      this.prisma.vendorFollow.findMany({
        where: { userId, vendor: { isActive: true, isApproved: true } },
        orderBy: { createdAt: 'desc' },
        take: 24,
        select: { vendorId: true },
      }),
      this.prisma.recommendationEvent.findMany({
        where: {
          userId,
          eventType: 'IMPRESSION',
          surface: 'HOME_FOLLOWING',
          productId: { not: null },
          createdAt: {
            gte: new Date(
              Date.now() - EXPOSURE_SUPPRESSION_DAYS * 24 * 60 * 60 * 1000,
            ),
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { productId: true },
      }),
    ]);
    const vendorIds = followed.map(({ vendorId }) => vendorId);
    if (!vendorIds.length) return [];
    const suppressedIds = recentImpressions.flatMap(({ productId }) =>
      productId ? [productId] : [],
    );
    // Fetch each followed store's small product pool separately so a store
    // with many recent products cannot crowd the other followed stores out.
    const findStoreProducts = async (vendorId: string) => {
      const availableWhere: Prisma.ProductWhereInput = {
        vendorId,
        isActive: true,
        isDeleted: false,
        category: { is: { isActive: true } },
        ...AVAILABLE_PRODUCT,
      };
      const unseenProducts = await this.prisma.product.findMany({
        where: suppressedIds.length
          ? { ...availableWhere, id: { notIn: suppressedIds } }
          : availableWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 4,
        select: { id: true },
      });
      if (unseenProducts.length) return unseenProducts;

      // Keep a followed store represented when all of its available products
      // were recently shown; impression suppression should not hide the store.
      return this.prisma.product.findMany({
        where: availableWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true },
      });
    };
    const storeProducts: Array<Array<{ id: string }>> = [];
    for (let offset = 0; offset < vendorIds.length; offset += 10) {
      const batch = await Promise.all(
        vendorIds.slice(offset, offset + 10).map(findStoreProducts),
      );
      storeProducts.push(...batch);
    }
    const selectedIds: string[] = [];
    for (let productIndex = 0; productIndex < 4; productIndex += 1) {
      for (const productsForStore of storeProducts) {
        if (productIndex > 0 && selectedIds.length >= 24) break;
        const product = productsForStore[productIndex];
        if (!product) continue;
        selectedIds.push(product.id);
      }
      // Give every followed store its newest eligible product before adding
      // more picks. Keep the optional extra picks within the normal shelf size.
      if (productIndex === 0 && storeProducts.length >= 24) break;
      if (selectedIds.length >= 24) break;
    }
    const cardBatches = await Promise.all(
      Array.from({ length: Math.ceil(selectedIds.length / 24) }, (_, index) =>
        this.products.findPublicCardsByIds(
          selectedIds.slice(index * 24, (index + 1) * 24),
          true,
        ),
      ),
    );
    return cardBatches.flat();
  }

  async discoverStores(
    userId?: string,
    sessionId?: string,
    visitorId?: string,
  ) {
    const guestHistoryIds = [
      ...new Set(
        [visitorId, sessionId].filter((id): id is string => Boolean(id)),
      ),
    ];
    const historyStart = new Date(
      Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000,
    );
    const recentViews =
      userId || guestHistoryIds.length
        ? await this.prisma.recentProductView.findMany({
            where: userId
              ? {
                  OR: [
                    { userId },
                    ...(guestHistoryIds.length
                      ? [{ visitorId: { in: guestHistoryIds } }]
                      : []),
                  ],
                  lastViewedAt: { gte: historyStart },
                }
              : {
                  visitorId: { in: guestHistoryIds },
                  lastViewedAt: { gte: historyStart },
                },
            orderBy: { lastViewedAt: 'desc' },
            take: 60,
            select: { product: { select: { categoryId: true } } },
          })
        : [];
    const categoryWeights = new Map<string, number>();
    recentViews.forEach(({ product }, index) => {
      addWeight(categoryWeights, product.categoryId, Math.pow(0.94, index));
    });

    const candidates = await this.prisma.vendor.findMany({
      where: {
        isActive: true,
        isApproved: true,
        ...(userId ? { follows: { none: { userId } } } : {}),
        products: {
          some: {
            isActive: true,
            isDeleted: false,
            category: { is: { isActive: true } },
            ...AVAILABLE_PRODUCT,
          },
        },
      },
      orderBy: [{ isVerified: 'desc' }, { createdAt: 'desc' }],
      take: 60,
      select: {
        id: true,
        storeName: true,
        storeSlug: true,
        storeDescription: true,
        storeLogoUrl: true,
        isVerified: true,
        createdAt: true,
        products: {
          where: {
            isActive: true,
            isDeleted: false,
            category: { is: { isActive: true } },
            ...AVAILABLE_PRODUCT,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 2,
          select: {
            id: true,
            name: true,
            slug: true,
            price: true,
            stock: true,
            hasVariants: true,
            categoryId: true,
            createdAt: true,
            variants: {
              where: { isActive: true, isDeleted: false },
              select: { stock: true },
            },
            images: {
              where: { isPrimary: true },
              take: 1,
              select: { url: true },
            },
          },
        },
      },
    });

    return candidates
      .map((vendor) => {
        const categoryScore = vendor.products.reduce(
          (score, product) =>
            score + (categoryWeights.get(product.categoryId) ?? 0),
          0,
        );
        const newestProductAt = vendor.products.reduce(
          (newest, product) => Math.max(newest, product.createdAt.getTime()),
          0,
        );
        return {
          vendor,
          score:
            categoryScore * 5 +
            (vendor.isVerified ? 0.5 : 0) +
            newestProductAt / 1e13,
        };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.vendor.createdAt.getTime() - a.vendor.createdAt.getTime(),
      )
      .slice(0, 10)
      .map(({ vendor }) => ({
        id: vendor.id,
        storeName: vendor.storeName,
        storeSlug: vendor.storeSlug,
        storeDescription: vendor.storeDescription,
        storeLogoUrl: vendor.storeLogoUrl,
        isVerified: vendor.isVerified,
        createdAt: vendor.createdAt,
        featuredProducts: vendor.products.map((product) => {
          const totalStock = product.hasVariants
            ? product.variants.reduce(
                (total, variant) => total + variant.stock,
                0,
              )
            : product.stock;
          const { stockStatus } = getStockStatus(totalStock, true);

          return {
            id: product.id,
            name: product.name,
            slug: product.slug,
            price: Number(product.price),
            discountPrice: null,
            thumbnail: product.images[0]?.url ?? null,
            stockStatus,
            hasVariants: product.hasVariants,
            vendor: {
              id: vendor.id,
              storeName: vendor.storeName,
              storeSlug: vendor.storeSlug,
              storeLogoUrl: vendor.storeLogoUrl ?? undefined,
              isVerified: vendor.isVerified,
            },
          };
        }),
      }));
  }

  async related(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
        isDeleted: false,
        category: { is: { isActive: true } },
      },
      select: {
        id: true,
        categoryId: true,
        vendorId: true,
        category: { select: { parentId: true } },
      },
    });
    if (!product) return [];

    const siblingCategories = product.category.parentId
      ? await this.prisma.category.findMany({
          where: { parentId: product.category.parentId, isActive: true },
          select: { id: true },
        })
      : [];
    const categoryIds = [
      ...new Set([
        product.categoryId,
        ...siblingCategories.map(({ id }) => id),
      ]),
    ];

    const coPurchased = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        productId: { not: productId },
        order: {
          status: { in: PURCHASE_STATUSES },
          orderItems: { some: { productId } },
        },
        product: {
          isActive: true,
          isDeleted: false,
          category: { is: { isActive: true } },
          vendor: { isActive: true, isApproved: true },
          ...AVAILABLE_PRODUCT,
        },
      },
      _sum: { quantity: true },
      _count: { _all: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 100,
    });
    const contentCandidates = await this.prisma.product.findMany({
      where: {
        id: { not: productId },
        isActive: true,
        isDeleted: false,
        category: { is: { isActive: true } },
        vendor: { isActive: true, isApproved: true },
        AND: [
          AVAILABLE_PRODUCT,
          {
            OR: [
              { categoryId: { in: categoryIds } },
              { vendorId: product.vendorId },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        name: true,
        description: true,
        categoryId: true,
        vendorId: true,
        createdAt: true,
        category: { select: { name: true } },
      },
    });

    const coPurchaseScores = new Map(
      coPurchased.map((item) => [
        item.productId,
        Math.log1p(item._sum.quantity ?? 0) * 4 +
          Math.log1p(item._count._all) * 3,
      ]),
    );
    const contentProducts = new Map(
      contentCandidates.map((candidate) => [candidate.id, candidate]),
    );
    const coPurchaseOnlyIds = coPurchased
      .map(({ productId: id }) => id)
      .filter((id) => !contentProducts.has(id));
    const coPurchaseOnly = coPurchaseOnlyIds.length
      ? await this.prisma.product.findMany({
          where: {
            id: { in: coPurchaseOnlyIds },
            isActive: true,
            isDeleted: false,
            category: { is: { isActive: true } },
            vendor: { isActive: true, isApproved: true },
            ...AVAILABLE_PRODUCT,
          },
          select: {
            id: true,
            name: true,
            description: true,
            categoryId: true,
            vendorId: true,
            createdAt: true,
            category: { select: { name: true } },
          },
        })
      : [];

    const candidates = [...contentCandidates, ...coPurchaseOnly];
    const recommendedIds = scoreAndDiversify(
      candidates,
      new Set([productId]),
      new Map(categoryIds.map((id) => [id, 2])),
      new Map([[product.vendorId, 1]]),
      new Map(),
      coPurchaseScores,
    );
    // Keep the PDP shelf tied to the current product's co-purchase and catalog
    // relationships. Generic trending items are not a valid related fallback.
    return this.products.findPublicCardsByIds(recommendedIds, true);
  }
}

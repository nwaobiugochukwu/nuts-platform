/** Personalised picks shown in the search drawer. */
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { ProductsService } from '@api/modules/products/services/products.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { StoreDiscoveryService } from './store-discovery.service';
import {
  SEARCH_DISCOVERY_PRODUCT_LIMIT,
  SEARCH_DISCOVERY_VENDOR_LIMIT,
  SEARCH_DISCOVERY_POOL_LIMIT,
  HISTORY_DAYS,
  AVAILABLE_PRODUCT,
  SearchDiscoveryCandidate,
  addWeight,
  stableHash,
  stableUuidCursor,
  searchTokens,
} from '../utils/recommendation.util';

@Injectable()
export class SearchDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    private readonly stores: StoreDiscoveryService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  async searchDiscover(
    userId?: string,
    sessionId?: string,
    visitorId?: string,
  ) {
    const actorId = userId ?? visitorId ?? sessionId;
    if (!actorId) return { items: [] };

    const fetcher = async () => {
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
          }
        : {
            visitorId: { in: guestIds.length ? guestIds : [actorId] },
            lastViewedAt: { gte: historyStart },
          };

      const searchActorWhere: Prisma.SearchQueryWhereInput[] = [
        ...(userId ? [{ userId }] : []),
        ...(sessionId ? [{ userId: null, sessionId }] : []),
      ];
      const [recentViews, discoveredStores, recentSearches] = await Promise.all(
        [
          this.prisma.recentProductView.findMany({
            where: historyWhere,
            orderBy: [{ lastViewedAt: 'desc' }, { id: 'asc' }],
            take: 40,
            select: {
              productId: true,
              product: { select: { categoryId: true, vendorId: true } },
            },
          }),
          this.stores.discoverStores(userId, sessionId, visitorId),
          searchActorWhere.length
            ? this.prisma.searchQuery.findMany({
                where: {
                  OR: searchActorWhere,
                  createdAt: { gte: historyStart },
                },
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: { query: true },
              })
            : Promise.resolve([] as Array<{ query: string }>),
        ],
      );
      // Fresh searches are the strongest short-term intent signal.
      const searchIntent = searchTokens(recentSearches.map((q) => q.query));

      const viewedProductIds = [
        ...new Set(recentViews.map(({ productId }) => productId)),
      ];
      const categoryWeights = new Map<string, number>();
      const vendorWeights = new Map<string, number>();
      recentViews.forEach(({ product }, index) => {
        if (!product) return;
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
      for (const token of searchIntent.keys()) {
        signalConditions.push({
          name: { contains: token, mode: 'insensitive' },
        });
      }
      const notRecentlyViewed: Prisma.ProductWhereInput =
        viewedProductIds.length ? { id: { notIn: viewedProductIds } } : {};
      const matchingCandidates = signalConditions.length
        ? await this.prisma.product.findMany({
            where: {
              ...availableWhere,
              ...notRecentlyViewed,
              OR: signalConditions,
            },
            orderBy: { id: 'asc' },
            take: SEARCH_DISCOVERY_POOL_LIMIT,
            select: {
              id: true,
              name: true,
              categoryId: true,
              vendorId: true,
            },
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
          select: { id: true, name: true, categoryId: true, vendorId: true },
        });
        const remaining = SEARCH_DISCOVERY_POOL_LIMIT - tail.length;
        const head =
          remaining > 0
            ? await this.prisma.product.findMany({
                where: { AND: [where, { id: { lt: cursorId } }] },
                orderBy: { id: 'asc' },
                take: remaining,
                select: {
                  id: true,
                  name: true,
                  categoryId: true,
                  vendorId: true,
                },
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

      const candidateById = new Map<
        string,
        SearchDiscoveryCandidate & { name?: string }
      >();
      for (const candidate of [...matchingCandidates, ...fallbackCandidates]) {
        candidateById.set(candidate.id, candidate);
      }
      const searchBonus = (name?: string) => {
        if (!name || searchIntent.size === 0) return 0;
        const lowered = name.toLocaleLowerCase();
        let bonus = 0;
        for (const [token, weight] of searchIntent) {
          if (lowered.includes(token)) bonus += weight;
        }
        return bonus * 6;
      };
      const candidates = [...candidateById.values()]
        .map((candidate) => ({
          ...candidate,
          score:
            (categoryWeights.get(candidate.categoryId) ?? 0) * 4 +
            (vendorWeights.get(candidate.vendorId) ?? 0) * 1.5 +
            searchBonus(candidate.name) +
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
        const products = store.featuredProducts
          .slice(0, 2)
          .flatMap(({ id }) => {
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
    };

    return this.cacheService
      ? this.cacheService.wrap(
          `recommendations:search-discover:${actorId}`,
          60,
          fetcher,
        )
      : fetcher();
  }
}

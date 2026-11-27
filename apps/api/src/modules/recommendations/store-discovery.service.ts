/** Marketplace mix and store discovery shelves. */
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { ProductsService } from '@api/modules/products/products.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { getStockStatus } from '@api/common/utils/stock-status.util';

import {
  MARKETPLACE_MIX_VENDOR_LIMIT,
  MARKETPLACE_MIX_PRODUCT_LIMIT,
  MARKETPLACE_MIX_MAX_PRODUCTS_PER_VENDOR,
  MARKETPLACE_MIX_POOL_LIMIT,
  HISTORY_DAYS,
  AVAILABLE_PRODUCT,
  MarketplaceMixCandidate,
  MarketplaceMixVendor,
  addWeight,
  stableHash,
  stableUuidCursor,
} from './recommendation.shared';

@Injectable()
export class StoreDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  async marketplaceMix(
    userId?: string,
    sessionId?: string,
    visitorId?: string,
  ) {
    const actorId = userId ?? visitorId ?? sessionId;
    if (!actorId) return { vendors: [] };
    const dayKey = new Date().toISOString().slice(0, 10);

    const fetcher = async () => {
      const availableWhere: Prisma.ProductWhereInput = {
        isActive: true,
        isDeleted: false,
        category: { is: { isActive: true } },
        vendor: {
          is: {
            isActive: true,
            isApproved: true,
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
            stableHash(`${actorId}:${dayKey}:${candidate.vendorId}`) /
            0xffffffff;
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
          const productLimit =
            baseSlotsPerVendor + (index < extraSlots ? 1 : 0);
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
    };

    return this.cacheService
      ? this.cacheService.wrap(
          `recommendations:mix:${actorId}:${dayKey}`,
          600,
          fetcher,
        )
      : fetcher();
  }

  async discoverStores(
    userId?: string,
    sessionId?: string,
    visitorId?: string,
  ) {
    const actorKey = userId ?? visitorId ?? sessionId ?? 'anonymous';
    const fetcher = async () => {
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
    };

    return this.cacheService
      ? this.cacheService.wrap(
          `recommendations:stores:${actorKey}`,
          180,
          fetcher,
        )
      : fetcher();
  }
}

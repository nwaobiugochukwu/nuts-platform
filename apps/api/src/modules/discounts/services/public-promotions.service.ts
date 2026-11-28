import { Injectable, Logger, Optional } from '@nestjs/common';

import { DiscountCodeScope, DiscountCodeType } from '@prisma/client';

import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { isProductEligible } from '../utils/discount-eligibility.util';

import {
  BatchProductDiscountsDto,
  ProductVoucherSummaryDto,
  PublicPlatformPromoDto,
  PublicProductDealDto,
} from '../dto';

import { isFirstOrderOnlyDiscount } from '../utils/first-order.util';
import { FirstOrderEligibilityService } from './first-order-eligibility.service';

/**
 * What the storefront shows shoppers about offers: the platform's current campaigns, and the deals
 * on a product or a batch of products. Read-only, cached, and personalised only in what it hides
 * (a first-order offer for someone who has ordered, an offer the shopper has used up).
 */
@Injectable()
export class PublicPromotionsService {
  private readonly logger = new Logger(PublicPromotionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firstOrder: FirstOrderEligibilityService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  // ============================================================
  // PUBLIC STOREFRONT PROMOTIONS & DEALS
  // ============================================================

  /**
   * Discounts this customer has already used the maximum number of times
   * (`perUserUsageLimit`). Storefront surfaces hide them for that customer: a
   * "10% OFF" chip or a "with CODE" hint for an offer they can no longer use is noise,
   * and the claim/checkout rules would refuse it anyway.
   */
  async findExhaustedCodeIds(
    userId: string | undefined,
    codeIds: string[],
  ): Promise<Set<string>> {
    if (!userId || codeIds.length === 0) return new Set();
    const [codes, usages] = await Promise.all([
      this.prisma.discountCode.findMany({
        where: { id: { in: codeIds }, perUserUsageLimit: { not: null } },
        select: { id: true, perUserUsageLimit: true },
      }),
      this.prisma.discountCodeUserUsage.findMany({
        where: { userId, discountCodeId: { in: codeIds } },
        select: { discountCodeId: true, usageCount: true },
      }),
    ]);
    const used = new Map(usages.map((u) => [u.discountCodeId, u.usageCount]));
    return new Set(
      codes
        .filter((c) => (used.get(c.id) ?? 0) >= (c.perUserUsageLimit ?? 0))
        .map((c) => c.id),
    );
  }

  async getPublicPlatformPromos(
    userId?: string,
  ): Promise<PublicPlatformPromoDto[]> {
    const fetcher = async () => {
      const now = new Date();
      const upcomingThreshold = new Date(
        now.getTime() + 7 * 24 * 60 * 60 * 1000,
      );
      const codes = await this.prisma.discountCode.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          scope: DiscountCodeScope.PLATFORM,
          AND: [
            {
              OR: [
                { startsAt: null },
                { startsAt: { lte: upcomingThreshold } },
              ],
            },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
      });

      // Exhausted codes are removed BEFORE the display limit so they can never
      // crowd valid codes out of the banner. Percent offers rank above fixed
      // ones (their raw numbers are not comparable), then by size.
      const rankValue = (c: (typeof codes)[number]) =>
        (c.type === DiscountCodeType.PERCENTAGE ? 1_000_000 : 0) +
        Number(c.value);
      const started = (c: (typeof codes)[number]) =>
        c.startsAt === null || c.startsAt <= now ? 0 : 1;

      return codes
        .filter((c) => c.usageLimit === null || c.usageCount < c.usageLimit)
        .sort(
          (a, b) =>
            started(a) - started(b) ||
            // A welcome offer for first-time shoppers never outranks the
            // campaigns everyone can use.
            Number(isFirstOrderOnlyDiscount(a)) -
              Number(isFirstOrderOnlyDiscount(b)) ||
            rankValue(b) - rankValue(a) ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .slice(0, 10)
        .map((c) => ({
          id: c.id,
          code: c.code,
          description: c.description,
          type: c.type,
          value: Number(c.value),
          maxDiscountAmount: c.maxDiscountAmount
            ? Number(c.maxDiscountAmount)
            : null,
          minOrderAmount: Number(c.minOrderAmount),
          startsAt: c.startsAt,
          expiresAt: c.expiresAt,
          isFirstOrderOnly: isFirstOrderOnlyDiscount(c),
          autoApply: c.autoApply,
        }));
    };

    const promos = this.cacheService
      ? await this.cacheService.wrap(
          'discounts:platform-promos:v3',
          120,
          fetcher,
        )
      : await fetcher();
    const visible = (await this.firstOrder.hasPriorOrders(userId))
      ? promos.filter((promo) => !promo.isFirstOrderOnly)
      : promos;
    const exhausted = await this.findExhaustedCodeIds(
      userId,
      visible.map((promo) => promo.id),
    );
    if (exhausted.size === 0) return visible;
    // Keep them (a vanishing banner looks like a bug) but flag them so the storefront can
    // tag the offer as used instead of offering it; used offers go last.
    return visible
      .map((promo) => ({ ...promo, usedByYou: exhausted.has(promo.id) }))
      .sort((a, b) => Number(a.usedByYou) - Number(b.usedByYou));
  }

  async getPublicProductDeals(
    productId: string,
    userId?: string,
  ): Promise<PublicProductDealDto> {
    type CachedPublicProductDeal = PublicProductDealDto & {
      productPrice: number;
    };
    const fetcher = async (): Promise<CachedPublicProductDeal> => {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          vendorId: true,
          categoryId: true,
          category: { select: { parentId: true } },
          price: true,
          isActive: true,
          isDeleted: true,
        },
      });

      if (!product || !product.isActive || product.isDeleted) {
        return {
          productId,
          bestDiscount: null,
          unlockableDiscount: null,
          allVouchers: [],
          productPrice: 0,
        };
      }

      const now = new Date();
      const productPrice = Number(product.price);
      const productCategoryIds = [
        product.categoryId,
        ...(product.category?.parentId ? [product.category.parentId] : []),
      ];

      const codes = await this.prisma.discountCode.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
          OR: [
            { platformwide: true },
            { vendorId: product.vendorId },
            { applicableProductIds: { has: productId } },
            { applicableCategoryIds: { hasSome: productCategoryIds } },
          ],
        },
        orderBy: [{ value: 'desc' }],
      });

      // DB filter above is only a coarse pre-filter; the shared eligibility
      // rules decide what is actually shown, exactly as checkout will.
      const validCodes = codes.filter(
        (c) =>
          (c.usageLimit === null || c.usageCount < c.usageLimit) &&
          isProductEligible(c, {
            id: productId,
            vendorId: product.vendorId,
            categoryIds: productCategoryIds,
          }),
      );

      const allVouchers: ProductVoucherSummaryDto[] = validCodes.map((c) => {
        const val = Number(c.value);
        const minOrder = Number(c.minOrderAmount);
        const spendMet = productPrice >= minOrder || minOrder <= 0;
        // "Buy 3+" offers cannot apply to one item, so they are shown as conditional.
        const meetsMinSpend = spendMet && (c.minQuantity ?? 1) <= 1;
        const shortfall = spendMet ? 0 : Math.max(0, minOrder - productPrice);

        let estimatedSavings = 0;
        if (c.type === DiscountCodeType.PERCENTAGE) {
          estimatedSavings = (productPrice * val) / 100;
          if (c.maxDiscountAmount) {
            estimatedSavings = Math.min(
              estimatedSavings,
              Number(c.maxDiscountAmount),
            );
          }
        } else {
          estimatedSavings = Math.min(productPrice, val);
        }

        const dealPrice = Math.max(
          0,
          Math.round((productPrice - estimatedSavings) * 100) / 100,
        );

        return {
          id: c.id,
          code: c.code,
          description: c.description,
          type: c.type,
          value: val,
          scope: c.scope,
          minOrderAmount: minOrder,
          maxDiscountAmount: c.maxDiscountAmount
            ? Number(c.maxDiscountAmount)
            : null,
          estimatedSavings: Math.round(estimatedSavings * 100) / 100,
          dealPrice: meetsMinSpend ? dealPrice : undefined,
          isApplicable: meetsMinSpend,
          minOrderShortfall: Math.round(shortfall * 100) / 100,
          expiresAt: c.expiresAt,
          isFirstOrderOnly: isFirstOrderOnlyDiscount(c),
          autoApply: c.autoApply,
          minQuantity: c.minQuantity,
        };
      });

      // Prioritize immediately applicable deals first (highest savings),
      // then conditional/unlockable order vouchers (lowest spend deficit first)
      allVouchers.sort((a, b) => {
        if (a.isApplicable && !b.isApplicable) return -1;
        if (!a.isApplicable && b.isApplicable) return 1;
        if (a.isApplicable && b.isApplicable) {
          return b.estimatedSavings - a.estimatedSavings;
        }
        const diff = (a.minOrderShortfall ?? 0) - (b.minOrderShortfall ?? 0);
        if (diff !== 0) return diff;
        return b.estimatedSavings - a.estimatedSavings;
      });

      const topApplicable = allVouchers.find(
        (v) => v.isApplicable && v.estimatedSavings > 0,
      );
      const bestDiscount = topApplicable
        ? {
            ...topApplicable,
            dealPrice:
              topApplicable.dealPrice ??
              Math.max(
                0,
                Math.round(
                  (productPrice - topApplicable.estimatedSavings) * 100,
                ) / 100,
              ),
          }
        : null;

      const topConditional = allVouchers.find(
        (v) => !v.isApplicable && v.estimatedSavings > 0,
      );
      const unlockableDiscount = topConditional
        ? {
            ...topConditional,
            minOrderAmount: topConditional.minOrderAmount,
            minOrderShortfall: topConditional.minOrderShortfall ?? 0,
          }
        : null;

      return {
        productId,
        bestDiscount,
        unlockableDiscount,
        allVouchers,
        productPrice,
      };
    };

    const cachedDeal = this.cacheService
      ? await this.cacheService.wrap(
          `discounts:product:v4:${productId}`,
          180,
          fetcher,
        )
      : await fetcher();

    const hasPriorOrders = await this.firstOrder.hasPriorOrders(userId);
    const exhausted = await this.findExhaustedCodeIds(
      userId,
      cachedDeal.allVouchers.map((voucher) => voucher.id),
    );
    if (hasPriorOrders || exhausted.size > 0) {
      // Used-up vouchers stay in the list (flagged) so the product page can say "Used",
      // but never count towards the best or unlockable deal.
      const allVouchers = cachedDeal.allVouchers
        .filter((voucher) => !hasPriorOrders || !voucher.isFirstOrderOnly)
        .map((voucher) =>
          exhausted.has(voucher.id) ? { ...voucher, usedByYou: true } : voucher,
        )
        .sort((a, b) => Number(!!a.usedByYou) - Number(!!b.usedByYou));
      const topApplicable = allVouchers.find(
        (v) => !v.usedByYou && v.isApplicable && v.estimatedSavings > 0,
      );
      const topConditional = allVouchers.find(
        (v) => !v.usedByYou && !v.isApplicable && v.estimatedSavings > 0,
      );
      return {
        productId,
        allVouchers,
        bestDiscount: topApplicable
          ? {
              ...topApplicable,
              dealPrice:
                topApplicable.dealPrice ??
                Math.max(
                  0,
                  Math.round(
                    (cachedDeal.productPrice - topApplicable.estimatedSavings) *
                      100,
                  ) / 100,
                ),
            }
          : null,
        unlockableDiscount: topConditional
          ? {
              ...topConditional,
              minOrderAmount: topConditional.minOrderAmount,
              minOrderShortfall: topConditional.minOrderShortfall ?? 0,
            }
          : null,
      };
    }

    return {
      productId,
      bestDiscount: cachedDeal.bestDiscount,
      unlockableDiscount: cachedDeal.unlockableDiscount,
      allVouchers: cachedDeal.allVouchers,
    };
  }

  /** Card deals for a batch of products, minus offers this customer has used up. */
  async getBatchProductDeals(
    dto: BatchProductDiscountsDto,
    userId?: string,
  ): ReturnType<PublicPromotionsService['computeBatchProductDeals']> {
    const result = await this.computeBatchProductDeals(dto, userId);
    if (!userId) return result;

    const ids = new Set<string>();
    for (const entry of Object.values(result)) {
      if (entry.bestDiscount) ids.add(entry.bestDiscount.id);
      if (entry.unlockableDiscount) ids.add(entry.unlockableDiscount.id);
    }
    const exhausted = await this.findExhaustedCodeIds(userId, [...ids]);
    if (exhausted.size === 0) return result;

    for (const entry of Object.values(result)) {
      if (entry.bestDiscount && exhausted.has(entry.bestDiscount.id)) {
        entry.bestDiscount = null;
      }
      if (
        entry.unlockableDiscount &&
        exhausted.has(entry.unlockableDiscount.id)
      ) {
        entry.unlockableDiscount = null;
      }
    }
    return result;
  }

  private async computeBatchProductDeals(
    dto: BatchProductDiscountsDto,
    userId?: string,
  ): Promise<
    Record<
      string,
      {
        bestDiscount: (ProductVoucherSummaryDto & { dealPrice: number }) | null;
        unlockableDiscount?:
          | (ProductVoucherSummaryDto & {
              minOrderAmount: number;
              minOrderShortfall: number;
            })
          | null;
      }
    >
  > {
    const productIds = [...new Set(dto.productIds)];
    if (productIds.length === 0) return {};

    const hasPriorOrders = await this.firstOrder.hasPriorOrders(userId);
    const audienceKey = hasPriorOrders ? 'repeat' : 'first';

    const result: Record<
      string,
      {
        bestDiscount: (ProductVoucherSummaryDto & { dealPrice: number }) | null;
        unlockableDiscount?:
          | (ProductVoucherSummaryDto & {
              minOrderAmount: number;
              minOrderShortfall: number;
            })
          | null;
      }
    > = {};

    const uncachedIds: string[] = [];

    if (this.cacheService) {
      await Promise.all(
        productIds.map(async (id) => {
          const cached = await this.cacheService?.get<{
            bestDiscount:
              | (ProductVoucherSummaryDto & {
                  dealPrice: number;
                })
              | null;
            unlockableDiscount?:
              | (ProductVoucherSummaryDto & {
                  minOrderAmount: number;
                  minOrderShortfall: number;
                })
              | null;
          }>(`discounts:deal:v4:${id}:${audienceKey}`);
          if (cached !== undefined) {
            result[id] = cached;
          } else {
            uncachedIds.push(id);
          }
        }),
      );
    } else {
      uncachedIds.push(...productIds);
    }

    if (uncachedIds.length === 0) {
      return result;
    }

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: uncachedIds },
        isActive: true,
        isDeleted: false,
      },
      select: {
        id: true,
        vendorId: true,
        categoryId: true,
        category: { select: { parentId: true } },
        price: true,
      },
    });

    const categoryIdsOf = (p: (typeof products)[number]) => [
      p.categoryId,
      ...(p.category?.parentId ? [p.category.parentId] : []),
    ];
    const vendorIds = [...new Set(products.map((p) => p.vendorId))];
    const now = new Date();

    const codes = await this.prisma.discountCode.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
        OR: [
          { platformwide: true },
          { vendorId: { in: vendorIds } },
          { applicableProductIds: { hasSome: uncachedIds } },
          {
            applicableCategoryIds: {
              hasSome: [...new Set(products.flatMap(categoryIdsOf))],
            },
          },
        ],
      },
    });

    const validCodes = codes.filter(
      (c) =>
        (c.usageLimit === null || c.usageCount < c.usageLimit) &&
        (!hasPriorOrders || !isFirstOrderOnlyDiscount(c)),
    );

    for (const prod of products) {
      const prodPrice = Number(prod.price);
      const prodCategoryIds = categoryIdsOf(prod);
      const matchingCodes = validCodes.filter((c) =>
        isProductEligible(c, {
          id: prod.id,
          vendorId: prod.vendorId,
          categoryIds: prodCategoryIds,
        }),
      );

      let best: (ProductVoucherSummaryDto & { dealPrice: number }) | null =
        null;
      let maxApplicableSavings = 0;

      let unlockable:
        | (ProductVoucherSummaryDto & {
            minOrderAmount: number;
            minOrderShortfall: number;
          })
        | null = null;
      let maxConditionalSavings = 0;

      for (const c of matchingCodes) {
        const val = Number(c.value);
        const minOrder = Number(c.minOrderAmount);
        const spendMet = prodPrice >= minOrder || minOrder <= 0;
        const meetsMinSpend = spendMet && (c.minQuantity ?? 1) <= 1;
        const shortfall = spendMet ? 0 : Math.max(0, minOrder - prodPrice);

        let savings = 0;
        if (c.type === DiscountCodeType.PERCENTAGE) {
          savings = (prodPrice * val) / 100;
          if (c.maxDiscountAmount) {
            savings = Math.min(savings, Number(c.maxDiscountAmount));
          }
        } else {
          savings = Math.min(prodPrice, val);
        }

        const voucherSummary: ProductVoucherSummaryDto = {
          id: c.id,
          code: c.code,
          description: c.description,
          type: c.type,
          value: val,
          scope: c.scope,
          minOrderAmount: minOrder,
          maxDiscountAmount: c.maxDiscountAmount
            ? Number(c.maxDiscountAmount)
            : null,
          estimatedSavings: Math.round(savings * 100) / 100,
          dealPrice: meetsMinSpend
            ? Math.max(0, Math.round((prodPrice - savings) * 100) / 100)
            : undefined,
          isApplicable: meetsMinSpend,
          minOrderShortfall: Math.round(shortfall * 100) / 100,
          expiresAt: c.expiresAt,
          isFirstOrderOnly: isFirstOrderOnlyDiscount(c),
          autoApply: c.autoApply,
          minQuantity: c.minQuantity,
        };

        if (meetsMinSpend) {
          if (savings > maxApplicableSavings) {
            maxApplicableSavings = savings;
            best = {
              ...voucherSummary,
              dealPrice: Math.max(
                0,
                Math.round((prodPrice - savings) * 100) / 100,
              ),
            };
          }
        } else {
          if (savings > maxConditionalSavings) {
            maxConditionalSavings = savings;
            unlockable = {
              ...voucherSummary,
              minOrderAmount: minOrder,
              minOrderShortfall: Math.round(shortfall * 100) / 100,
            };
          }
        }
      }

      const dealEntry = { bestDiscount: best, unlockableDiscount: unlockable };
      result[prod.id] = dealEntry;
      if (this.cacheService) {
        void this.cacheService.set(
          `discounts:deal:v4:${prod.id}:${audienceKey}`,
          dealEntry,
          180,
        );
      }
    }

    return result;
  }
}

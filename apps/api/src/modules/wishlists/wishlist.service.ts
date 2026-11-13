import { Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@prisma/client';
import { Optional } from '@nestjs/common';

import { CacheService } from '@api/infrastructure/cache/cache.service';

import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { MarketplaceEventsService } from '@api/modules/analytics/tracking/marketplace-events.service';

import { WishlistResponseDto } from './dto/wishlist.dto';

const WISHLIST_CACHE_PREFIX = 'user:wishlist:v3:';

const WISHLIST_CACHE_TTL = 120;

/*
 * Keep the query intentionally small.
 *
 * Wishlist pages normally need a product card, not the entire product
 * entity with every relationship.
 */
const WISHLIST_ITEM_INCLUDE = {
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      hasVariants: true,

      images: {
        select: {
          url: true,
        },
        orderBy: {
          position: 'asc' as const,
        },
        take: 1,
      },
    },
  },

  variant: {
    select: {
      id: true,
      options: true,
    },
  },
} satisfies Prisma.WishlistItemInclude;

type WishlistItemWithRelations = Prisma.WishlistItemGetPayload<{
  include: typeof WISHLIST_ITEM_INCLUDE;
}>;

@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    @Optional() private readonly marketplaceEvents?: MarketplaceEventsService,
  ) {}

  // ---------------------------------------------------------------------------
  // ADD
  // ---------------------------------------------------------------------------

  async add(
    userId: string,
    productId: string,
    variantId?: string,
  ): Promise<WishlistResponseDto> {
    let normalizedVariantId = this.normalizeVariantId(variantId);

    /*
     * One product query validates:
     *
     * 1. product exists
     * 2. product is active
     * 3. product is not deleted
     * 4. requested variant belongs to this product (if specified)
     * 5. requested variant is active (if specified)
     * 6. requested variant is not deleted (if specified)
     */
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
        isDeleted: false,

        ...(normalizedVariantId
          ? {
              variants: {
                some: {
                  id: normalizedVariantId,
                  isActive: true,
                  isDeleted: false,
                },
              },
            }
          : {}),
      },

      select: {
        id: true,
        hasVariants: true,
        price: true,
        stock: true,
        vendorId: true,
        categoryId: true,

        /*
         * Only return the variant ID we actually need for validation.
         */
        variants: normalizedVariantId
          ? {
              where: {
                id: normalizedVariantId,
                isActive: true,
                isDeleted: false,
              },

              select: {
                id: true,
                stock: true,
              },

              take: 1,
            }
          : false,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found or unavailable');
    }

    // If client supplied a variant for a non-variant product, gracefully treat as null
    if (!product.hasVariants && normalizedVariantId) {
      normalizedVariantId = null;
    }

    if (normalizedVariantId && product.variants.length === 0) {
      throw new NotFoundException('Product variant not found or unavailable');
    }

    // Check if an item for this product already exists in user's wishlist
    const existing = await this.prisma.wishlistItem.findFirst({
      where: {
        userId,
        productId,
        ...(normalizedVariantId ? { variantId: normalizedVariantId } : {}),
      },
      include: WISHLIST_ITEM_INCLUDE,
    });

    if (existing) {
      // If user previously added product without variant, update to newly specified variant
      if (normalizedVariantId && !existing.variantId) {
        const updated = await this.prisma.wishlistItem.update({
          where: { id: existing.id },
          data: {
            variantId: normalizedVariantId,
            lastObservedPrice: product.price,
            lastObservedStock: product.variants[0]?.stock ?? 0,
            lastObservedAt: new Date(),
          },
          include: WISHLIST_ITEM_INCLUDE,
        });
        await this.invalidateCache(userId);
        return this.toResponseDto(updated);
      }
      return this.toResponseDto(existing);
    }

    const lastObservedStock = normalizedVariantId
      ? (product.variants[0]?.stock ?? 0)
      : product.hasVariants
        ? Math.max(
            0,
            (
              await this.prisma.productVariant.aggregate({
                where: {
                  productId,
                  isActive: true,
                  isDeleted: false,
                },
                _sum: { stock: true },
              })
            )._sum.stock ?? 0,
          )
        : product.stock;

    try {
      const item = await this.prisma.wishlistItem.create({
        data: {
          userId,
          productId,
          variantId: normalizedVariantId,
          lastObservedPrice: product.price,
          lastObservedStock,
          lastObservedAt: new Date(),
        },

        include: WISHLIST_ITEM_INCLUDE,
      });

      await this.invalidateCache(userId);

      await this.marketplaceEvents?.record({
        eventType: 'WISHLIST_ADD',
        vendorId: product.vendorId,
        productId,
        variantId: normalizedVariantId,
        categoryId: product.categoryId,
        userId,
        quantity: 1,
        surface: 'WISHLIST',
      });

      return this.toResponseDto(item);
    } catch (error) {
      /*
       * Prisma P2002 = unique constraint violation (concurrent duplicate request).
       */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const fallback = await this.prisma.wishlistItem.findFirst({
          where: {
            userId,
            productId,
          },
          include: WISHLIST_ITEM_INCLUDE,
        });
        if (fallback) {
          return this.toResponseDto(fallback);
        }
      }

      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // FIND MINE
  // ---------------------------------------------------------------------------

  async findMine(userId: string): Promise<WishlistResponseDto[]> {
    const cacheKey = this.getCacheKey(userId);

    return this.cacheService.wrap(cacheKey, WISHLIST_CACHE_TTL, async () => {
      /*
       * The user ID is part of the WHERE clause, so one user's wishlist
       * can never be returned for another user.
       */
      const items = await this.prisma.wishlistItem.findMany({
        where: {
          userId,

          /*
           * Don't expose deleted/inactive products in the wishlist.
           * They can remain in the DB until the user removes them.
           */
          product: {
            isActive: true,
            isDeleted: false,
          },
        },

        include: WISHLIST_ITEM_INCLUDE,

        orderBy: {
          createdAt: 'desc',
        },

        /*
         * Prevent an unexpectedly huge response.
         *
         * For a larger wishlist, pagination should replace this cap.
         */
        take: 200,
      });

      return items.map((item) => this.toResponseDto(item));
    });
  }

  // ---------------------------------------------------------------------------
  // REMOVE
  // ---------------------------------------------------------------------------

  async remove(
    userId: string,
    productId: string,
    variantId?: string,
  ): Promise<void> {
    const normalizedVariantId = this.normalizeVariantId(variantId);

    let itemForEvent = await this.prisma.wishlistItem.findFirst({
      where: {
        userId,
        productId,
        ...(normalizedVariantId ? { variantId: normalizedVariantId } : {}),
      },
      select: {
        product: { select: { vendorId: true, categoryId: true } },
      },
    });

    /*
     * If a specific variantId is supplied, attempt to delete that variant.
     * If no rows are deleted (or if variantId is omitted), delete any wishlist item
     * for this product and user so the product is guaranteed removed.
     */
    let result = await this.prisma.wishlistItem.deleteMany({
      where: {
        userId,
        productId,
        ...(normalizedVariantId ? { variantId: normalizedVariantId } : {}),
      },
    });

    if (result.count === 0 && normalizedVariantId) {
      itemForEvent = await this.prisma.wishlistItem.findFirst({
        where: { userId, productId },
        select: {
          product: { select: { vendorId: true, categoryId: true } },
        },
      });
      result = await this.prisma.wishlistItem.deleteMany({
        where: {
          userId,
          productId,
        },
      });
    }

    if (result.count > 0) {
      await this.invalidateCache(userId);
      if (itemForEvent) {
        await this.marketplaceEvents?.record({
          eventType: 'WISHLIST_REMOVE',
          vendorId: itemForEvent.product.vendorId,
          productId,
          variantId: normalizedVariantId,
          categoryId: itemForEvent.product.categoryId,
          userId,
          quantity: 1,
          surface: 'WISHLIST',
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // RESPONSE MAPPER
  // ---------------------------------------------------------------------------

  private toResponseDto(item: WishlistItemWithRelations): WishlistResponseDto {
    return {
      id: item.id,

      productId: item.productId,

      variantId: item.variantId,

      productName: item.product.name,

      productSlug: item.product.slug,

      productPrice: Number(item.product.price),

      productImage: item.product.images[0]?.url ?? null,

      variantName: this.getVariantName(item.variant?.options),

      createdAt: item.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // VARIANT OPTIONS
  // ---------------------------------------------------------------------------

  private getVariantName(options: unknown): string | null {
    if (!options) {
      return null;
    }

    /*
     * Current variant option format:
     *
     * [
     *   { name: "Color", value: "Black" },
     *   { name: "Size", value: "M" }
     * ]
     */
    if (Array.isArray(options)) {
      const values = options
        .filter(
          (option) =>
            typeof option === 'object' && option !== null && 'value' in option,
        )
        .map((option) =>
          String(
            (
              option as {
                value: unknown;
              }
            ).value,
          ),
        );

      return values.length ? values.join(', ') : null;
    }

    /*
     * Legacy format:
     *
     * {
     *   color: "Black",
     *   size: "M"
     * }
     */
    if (typeof options === 'object') {
      return Object.values(options as Record<string, unknown>)
        .map(String)
        .join(', ');
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // CACHE
  // ---------------------------------------------------------------------------

  private getCacheKey(userId: string): string {
    return `${WISHLIST_CACHE_PREFIX}${userId}`;
  }

  private async invalidateCache(userId: string): Promise<void> {
    await this.cacheService.del(this.getCacheKey(userId));
  }

  // ---------------------------------------------------------------------------
  // NORMALIZATION
  // ---------------------------------------------------------------------------

  private normalizeVariantId(
    variantId: string | undefined | null,
  ): string | null {
    const normalized = variantId?.trim();

    return normalized || null;
  }
}

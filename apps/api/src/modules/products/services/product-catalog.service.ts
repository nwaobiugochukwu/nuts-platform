import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { CacheService } from '@api/infrastructure/cache/cache.service';
import { SearchService } from '@api/modules/search/services/search.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';

import {
  PRODUCT_BY_SLUG,
  PRODUCT_TTL,
} from '@api/common/constants/cache.constants';

import { resolveCategoryIdFromPath } from '@api/common/utils/category-path.util';

import { createPaginationMeta } from '@api/common/utils/pagination-meta.util';
import { getPagination } from '@api/common/utils/pagination.util';

import {
  buildCursorMeta,
  getCursorPagination,
} from '@api/common/utils/cursor-pagination.util';

import { ProductCardDto } from '../dto/product-card.dto';
import { PublicProductResponseDto } from '../dto/public-product-response.dto';

import {
  buildProductCursorWhere,
  productCursorPayload,
  resolveProductOrderBy,
  publicListProductInclude,
  publicProductInclude,
  type PublicProductWithCategory,
} from '../utils/product-includes.util';
import {
  normalizeSearch,
  toCardResponse,
  toPublicResponse,
} from '../utils/product-response.mapper';

import { ProductCategoryResolverService } from './product-category-resolver.service';

/**
 * The public catalogue: what shoppers browse. Listings (by page and by cursor), a product page,
 * trending, category previews and cards by id, all cached, and none of them able to change a product.
 */
@Injectable()
export class ProductCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly searchService: SearchService,
    private readonly categories: ProductCategoryResolverService,
  ) {}

  /**
   * Traditional page-number pagination.
   *
   * Kept for clients already using GET /products.
   */
  async findAllPublic(params: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    categoryId?: string;
    categoryPath?: string;
    vendorId?: string;
    inStock?: boolean;
    minPrice?: number;
    maxPrice?: number;
    cursor?: string;
    sort?: string;
    bypassCache?: boolean;
  }): Promise<{
    data: ProductCardDto[];
    meta:
      | ReturnType<typeof createPaginationMeta>
      | ReturnType<typeof buildCursorMeta>;
  }> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(Math.max(1, params.limit ?? 10), 100);

    if (params.cursor !== undefined) {
      return this.findAllPublicCursor({
        limit,
        cursor: params.cursor,
        search: params.search,
        category: params.category,
        categoryId: params.categoryId,
        categoryPath: params.categoryPath,
        vendorId: params.vendorId,
        inStock: params.inStock,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
        sort: params.sort,
        bypassCache: params.bypassCache,
      });
    }

    const search = normalizeSearch(params.search);

    const cacheKey = this.getPublicProductsCacheKey({
      page,
      limit,
      search,
      categoryId: params.categoryId || params.category,
      categoryPath: params.categoryPath,
      vendorId: params.vendorId,
      inStock: params.inStock,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      sort: params.sort,
    });

    const loadProducts = async () => {
      const whereBase = await this.buildPublicWhere({
        search: undefined,
        category: params.category,
        categoryId: params.categoryId,
        categoryPath: params.categoryPath,
        vendorId: params.vendorId,
        inStock: params.inStock,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
      });

      /*
       * Prefer the external search index when a search term exists.
       *
       * The search engine determines relevance/order; Prisma is only used to
       * hydrate the actual product records.
       */
      if (search) {
        const searchResult = await this.searchService.searchProducts(
          search,
          undefined,
          page,
          limit,
        );

        if (searchResult) {
          if (searchResult.ids.length === 0) {
            const emptyResponse = {
              data: [],
              meta: createPaginationMeta(0, page, limit),
            };

            return emptyResponse;
          }

          const products = await this.prisma.product.findMany({
            where: {
              ...whereBase,
              id: {
                in: searchResult.ids,
              },
            },
            include: publicListProductInclude,
          });

          /*
           * Prisma's IN query does not preserve search-engine relevance order,
           * so rebuild the result in the order returned by SearchService.
           */
          const productsById = new Map(
            products.map((product) => [product.id, product]),
          );

          const orderedProducts = searchResult.ids.flatMap((id: string) => {
            const product = productsById.get(id);
            return product ? [product] : [];
          });

          const categoryMap = await this.categories.getCategoryLookupMap();

          const response = {
            data: orderedProducts.map((product) =>
              toCardResponse(product, categoryMap),
            ),
            meta: createPaginationMeta(searchResult.total, page, limit),
          };

          return response;
        }
      }

      /*
       * Database fallback when SearchService has no result/index available.
       *
       * Note:
       * `contains` with insensitive matching is convenient but is not the
       * long-term solution for very large catalogues. PostgreSQL trigram/FTS
       * or the search service should handle large-scale searching.
       */
      const where = await this.buildPublicWhere({
        search,
        category: params.category,
        categoryId: params.categoryId,
        categoryPath: params.categoryPath,
        vendorId: params.vendorId,
        inStock: params.inStock,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
      });

      const [total, products, categoryMap] = await Promise.all([
        this.prisma.product.count({
          where,
        }),

        this.prisma.product.findMany({
          where,
          include: publicListProductInclude,
          orderBy: resolveProductOrderBy(params.sort),
          ...getPagination(page, limit),
        }),

        this.categories.getCategoryLookupMap(),
      ]);

      const response = {
        data: products.map((product) => toCardResponse(product, categoryMap)),
        meta: createPaginationMeta(total, page, limit),
      };

      return response;
    };

    if (params.bypassCache) return loadProducts();
    return this.cacheService.wrap(cacheKey, PRODUCT_TTL, loadProducts);
  }

  /**
   * Cursor-paginated public product listing.
   *
   * Uses the active sort key plus a unique product ID as a deterministic
   * lexicographic cursor. The cursor predicate must be grouped under OR.
   */
  async findAllPublicCursor(params: {
    limit?: number;
    cursor?: string;
    search?: string;
    category?: string;
    categoryId?: string;
    categoryPath?: string;
    vendorId?: string;
    inStock?: boolean;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    bypassCache?: boolean;
  }): Promise<{
    data: ProductCardDto[];
    meta: ReturnType<typeof buildCursorMeta>;
  }> {
    const limit = Math.min(Math.max(1, params.limit ?? 10), 100);

    const search = normalizeSearch(params.search);

    const cacheKey = this.getPublicCursorCacheKey({
      cursor: params.cursor,
      limit,
      search,
      categoryId: params.categoryId || params.category,
      categoryPath: params.categoryPath,
      vendorId: params.vendorId,
      inStock: params.inStock,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
      sort: params.sort,
    });

    const loadProducts = async () => {
      const { take, decodedCursor } = getCursorPagination(limit, params.cursor);
      if (params.cursor && !decodedCursor) {
        throw new BadRequestException('Invalid product cursor.');
      }

      const where = await this.buildPublicWhere({
        search,
        category: params.category,
        categoryId: params.categoryId,
        categoryPath: params.categoryPath,
        vendorId: params.vendorId,
        inStock: params.inStock,
        minPrice: params.minPrice,
        maxPrice: params.maxPrice,
      });

      /*
       * IMPORTANT:
       *
       * Product cursor clauses are lexicographic alternatives.
       *
       * Never spread that array directly into the Prisma where object.
       *
       * WRONG:
       *
       * {
       *   ...where,
       *   ...cursorWhere
       * }
       *
       * That produces numeric object keys.
       *
       * Correct:
       *
       * {
       *   ...where,
       *   AND: [{ OR: cursorWhere }]
       * }
       */
      if (decodedCursor) {
        const cursorWhere = buildProductCursorWhere(decodedCursor, params.sort);

        const existingAnd = Array.isArray(where.AND)
          ? where.AND
          : where.AND
            ? [where.AND]
            : [];

        where.AND = [...existingAnd, { OR: cursorWhere }];
      }

      /*
       * Fetch one extra row.
       *
       * Example:
       * limit = 10
       * take = 11
       *
       * If 11 records are returned, there is another page.
       */
      const [products, categoryMap] = await Promise.all([
        this.prisma.product.findMany({
          where,
          include: publicListProductInclude,
          orderBy: resolveProductOrderBy(params.sort),
          take,
        }),
        this.categories.getCategoryLookupMap(),
      ]);

      const meta = buildCursorMeta(products, limit, (last) =>
        productCursorPayload(last, params.sort),
      );

      const response = {
        data: products
          .slice(0, limit)
          .map((product) => toCardResponse(product, categoryMap)),
        meta,
      };

      return response;
    };

    if (params.bypassCache) return loadProducts();
    return this.cacheService.wrap(cacheKey, PRODUCT_TTL, loadProducts);
  }

  /**
   * Public product detail by slug.
   */
  async findOnePublic(
    slug: string,
    bypassCache = false,
  ): Promise<PublicProductResponseDto> {
    const normalizedSlug = slug.trim();

    if (!normalizedSlug) {
      throw new BadRequestException('Product slug is required');
    }

    const cacheKey = PRODUCT_BY_SLUG(normalizedSlug);
    const loadProduct = async () => {
      const [product, categoryMap] = await Promise.all([
        this.prisma.product.findFirst({
          where: {
            slug: normalizedSlug,
            isDeleted: false,
            isActive: true,
            vendor: { isActive: true, isApproved: true },
          },
          include: publicProductInclude,
        }),
        this.categories.getCategoryLookupMap(),
      ]);

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      return toPublicResponse(product, true, categoryMap);
    };

    // Public product pages are often requested concurrently by the RSC page,
    // metadata generation, and link prefetches. Share the same cold lookup and
    // cache write so a cache miss does not fan out into duplicate DB queries.
    if (bypassCache) return loadProduct();
    return this.cacheService.wrap(cacheKey, PRODUCT_TTL, loadProduct);
  }

  /**
   * Public trending products by sales volume.
   *
   * Aggregates quantity sold from fulfilled, non-cancelled orders over the
   * trailing window. The result intentionally stays short when sales history is
   * sparse instead of presenting recent listings as popular products.
   */
  async findTrending(params: {
    limit?: number;
    days?: number;
    categoryId?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    bypassCache?: boolean;
  }): Promise<ProductCardDto[]> {
    const limit = Math.min(Math.max(1, params.limit ?? 20), 50);
    const days = Math.min(Math.max(1, params.days ?? 30), 365);
    const categoryIds = params.categoryId
      ? await this.categories.collectCategoryAndDescendantIds(params.categoryId)
      : undefined;
    const search = normalizeSearch(params.search);
    const cacheKey = `products:trending:${limit}:${days}:${params.categoryId ?? 'all'}:${search}:${params.minPrice ?? ''}:${params.maxPrice ?? ''}`;

    const loadTrending = async (): Promise<ProductCardDto[]> => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      // Aggregate sales quantity grouped by productId
      const topSales = await this.prisma.orderItem.groupBy({
        by: ['productId'],
        _sum: {
          quantity: true,
        },
        where: {
          order: {
            status: {
              in: [
                OrderStatus.CONFIRMED,
                OrderStatus.PROCESSING,
                OrderStatus.SHIPPED,
                OrderStatus.DELIVERED,
              ],
            },
            createdAt: { gte: cutoffDate },
          },
          product: {
            isActive: true,
            isDeleted: false,
            ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
            ...(search
              ? { name: { contains: search, mode: 'insensitive' as const } }
              : {}),
            ...(params.minPrice !== undefined || params.maxPrice !== undefined
              ? {
                  price: {
                    ...(params.minPrice !== undefined
                      ? { gte: params.minPrice }
                      : {}),
                    ...(params.maxPrice !== undefined
                      ? { lte: params.maxPrice }
                      : {}),
                  },
                }
              : {}),
            OR: [
              { stock: { gt: 0 } },
              {
                variants: {
                  some: { isActive: true, isDeleted: false, stock: { gt: 0 } },
                },
              },
            ],
            vendor: { isActive: true, isApproved: true },
          },
        },
        orderBy: {
          _sum: {
            quantity: 'desc',
          },
        },
        take: limit,
      });

      const topProductIds = topSales.map((s) => s.productId);
      let products: PublicProductWithCategory[] = [];

      if (topProductIds.length > 0) {
        const fetched = await this.prisma.product.findMany({
          where: {
            id: { in: topProductIds },
            isActive: true,
            isDeleted: false,
            OR: [
              { stock: { gt: 0 } },
              {
                variants: {
                  some: { isActive: true, isDeleted: false, stock: { gt: 0 } },
                },
              },
            ],
            vendor: { isActive: true, isApproved: true },
          },
          include: publicListProductInclude,
        });

        const productMap = new Map(fetched.map((p) => [p.id, p]));
        products = topProductIds
          .map((id) => productMap.get(id))
          .filter((p): p is PublicProductWithCategory => p !== undefined);
      }

      // If top sales returned fewer than limit (e.g. sparse sales or new category),
      // backfill with high-quality active in-stock products in the category/catalog
      // so "Top Picks" is never an empty wasteland.
      const remainingSlots = limit - products.length;
      if (remainingSlots > 0) {
        const existingIds = new Set(products.map((p) => p.id));
        const fallbacks = await this.prisma.product.findMany({
          where: {
            id: { notIn: Array.from(existingIds) },
            isActive: true,
            isDeleted: false,
            ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
            ...(search
              ? { name: { contains: search, mode: 'insensitive' as const } }
              : {}),
            ...(params.minPrice !== undefined || params.maxPrice !== undefined
              ? {
                  price: {
                    ...(params.minPrice !== undefined
                      ? { gte: params.minPrice }
                      : {}),
                    ...(params.maxPrice !== undefined
                      ? { lte: params.maxPrice }
                      : {}),
                  },
                }
              : {}),
            OR: [
              { stock: { gt: 0 } },
              {
                variants: {
                  some: { isActive: true, isDeleted: false, stock: { gt: 0 } },
                },
              },
            ],
            vendor: { isActive: true, isApproved: true },
          },
          orderBy: { createdAt: 'desc' },
          take: remainingSlots,
          include: publicListProductInclude,
        });
        products.push(...fallbacks);
      }

      const unitsSoldByProduct = new Map(
        topSales.map((sale) => [
          sale.productId,
          Number(sale._sum.quantity ?? 0),
        ]),
      );

      return products.map((product) => {
        const unitsSold = unitsSoldByProduct.get(product.id) ?? 0;
        let reason: string | undefined;
        if (unitsSold >= 10) {
          reason = `${unitsSold}+ bought recently`;
        } else if (unitsSold >= 5) {
          reason = 'Trending this week';
        } else if (unitsSold > 0) {
          reason = 'Popular pick';
        } else {
          reason = 'Featured pick';
        }
        return {
          ...toCardResponse(product),
          recommendationReason: reason,
        };
      });
    };

    if (params.bypassCache) return loadTrending();
    return this.cacheService.wrap(cacheKey, PRODUCT_TTL, loadTrending);
  }

  /**
   * Loads a small first page for each active direct child of a category.
   * The response stays bounded per child while letting the category page render
   * useful product rows before a shopper moves between subcategories.
   */
  async findCategoryPreviews(
    parentCategoryId: string,
    requestedLimit?: number,
  ): Promise<
    Record<
      string,
      { items: ProductCardDto[]; totalItems: number; totalPages: number }
    >
  > {
    const limit = Math.min(Math.max(1, requestedLimit ?? 12), 12);
    const children = await this.prisma.category.findMany({
      where: {
        parentId: parentCategoryId,
        isActive: true,
        status: 'ACTIVE',
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true },
    });

    const entries = await Promise.all(
      children.map(async (category) => {
        const result = await this.findAllPublic({
          categoryId: category.id,
          page: 1,
          limit,
          sort: 'newest',
        });
        const meta = result.meta as {
          totalItems?: number;
          total?: number;
          totalPages?: number;
        };
        return [
          category.id,
          {
            items: result.data,
            totalItems: Number(meta.totalItems ?? meta.total ?? 0),
            totalPages: Number(meta.totalPages ?? 0),
          },
        ] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  async findPublicCardsByIds(
    ids: string[],
    availableOnly = false,
  ): Promise<ProductCardDto[]> {
    const uniqueIds = [...new Set(ids)].slice(0, 24);
    if (uniqueIds.length === 0) return [];
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: uniqueIds },
        isActive: true,
        isDeleted: false,
        ...(availableOnly
          ? {
              OR: [
                { stock: { gt: 0 } },
                {
                  variants: {
                    some: {
                      isActive: true,
                      isDeleted: false,
                      stock: { gt: 0 },
                    },
                  },
                },
              ],
              vendor: { isActive: true, isApproved: true },
            }
          : {}),
      },
      include: publicListProductInclude,
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const categoryMap = await this.categories.getCategoryLookupMap();
    return uniqueIds
      .map((id) => byId.get(id))
      .filter((product): product is PublicProductWithCategory =>
        Boolean(product),
      )
      .map((product) => toCardResponse(product, categoryMap));
  }

  /* ==========================================================================
   * VENDOR READS
   * ======================================================================== */

  /* ==========================================================================
   * WHERE BUILDERS
   * ======================================================================== */

  /**
   * Builds the public storefront filter.
   */
  private async buildPublicWhere(params: {
    search?: string;
    category?: string;
    categoryId?: string;
    categoryPath?: string;
    vendorId?: string;
    inStock?: boolean;
    minPrice?: number;
    maxPrice?: number;
  }): Promise<Prisma.ProductWhereInput> {
    if (
      params.minPrice !== undefined &&
      params.maxPrice !== undefined &&
      params.minPrice > params.maxPrice
    ) {
      throw new BadRequestException(
        'minPrice must be less than or equal to maxPrice.',
      );
    }

    const andConditions: Prisma.ProductWhereInput[] = [
      {
        isDeleted: false,
        isActive: true,
        vendor: { isActive: true, isApproved: true },
      },
    ];

    if (params.vendorId) {
      andConditions.push({ vendorId: params.vendorId });
    }

    const rawCatIdentifier = params.categoryId || params.category;
    let targetCatId: string | undefined;

    if (rawCatIdentifier) {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          rawCatIdentifier,
        );
      if (isUuid) {
        targetCatId = rawCatIdentifier;
      } else {
        const found = await this.prisma.category.findFirst({
          where: {
            OR: [{ slug: rawCatIdentifier }, { path: rawCatIdentifier }],
          },
          select: { id: true },
        });
        targetCatId = found?.id;
        if (!targetCatId) {
          throw new NotFoundException('Category not found.');
        }
      }
    }
    if (!targetCatId && params.categoryPath) {
      targetCatId = await resolveCategoryIdFromPath(
        this.prisma,
        params.categoryPath,
      );
    }

    if (targetCatId) {
      const categoryIds =
        await this.categories.collectCategoryAndDescendantIds(targetCatId);

      andConditions.push({
        categoryId: {
          in: categoryIds,
        },
      });
    }

    if (params.inStock !== undefined) {
      if (params.inStock) {
        andConditions.push({
          OR: [
            { stock: { gt: 0 } },
            {
              hasVariants: true,
              variants: {
                some: {
                  stock: { gt: 0 },
                  isActive: true,
                  isDeleted: false,
                },
              },
            },
          ],
        });
      } else {
        andConditions.push({
          AND: [
            { stock: { lte: 0 } },
            {
              variants: {
                none: {
                  stock: { gt: 0 },
                  isActive: true,
                  isDeleted: false,
                },
              },
            },
          ],
        });
      }
    }

    if (params.minPrice !== undefined || params.maxPrice !== undefined) {
      const priceFilter: Prisma.DecimalFilter = {};
      if (params.minPrice !== undefined) {
        priceFilter.gte = params.minPrice;
      }
      if (params.maxPrice !== undefined) {
        priceFilter.lte = params.maxPrice;
      }
      andConditions.push({ price: priceFilter });
    }

    if (params.search) {
      andConditions.push({
        OR: [
          {
            name: {
              contains: params.search,
              mode: 'insensitive',
            },
          },
          {
            sku: {
              contains: params.search,
              mode: 'insensitive',
            },
          },
          {
            description: {
              contains: params.search,
              mode: 'insensitive',
            },
          },
        ],
      });
    }

    return {
      AND: andConditions,
    };
  }

  /**
   * Shared vendor/admin filter builder.
   */
  /**
   * Generates the page-pagination cache key.
   *
   * Every filter that affects the result MUST be represented in the key.
   */

  private getPublicProductsCacheKey(params: {
    page?: number;
    limit?: number;
    search?: string;
    categoryId?: string;
    categoryPath?: string;
    vendorId?: string;
    inStock?: boolean;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
  }): string {
    return [
      'product:list:public',
      `page:${params.page ?? 1}`,
      `limit:${params.limit ?? 10}`,
      `search:${encodeURIComponent(params.search ?? '')}`,
      `category:${params.categoryId ?? ''}`,
      `categoryPath:${encodeURIComponent(params.categoryPath ?? '')}`,
      `vendor:${params.vendorId ?? ''}`,
      `inStock:${params.inStock ?? ''}`,
      `minPrice:${params.minPrice ?? ''}`,
      `maxPrice:${params.maxPrice ?? ''}`,
      `sort:${params.sort ?? 'newest'}`,
    ].join(':');
  }

  /**
   * Generates the cursor-pagination cache key.
   */
  private getPublicCursorCacheKey(params: {
    cursor?: string;
    limit: number;
    search?: string;
    categoryId?: string;
    categoryPath?: string;
    vendorId?: string;
    inStock?: boolean;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
  }): string {
    return [
      'product:list:public:cursor',
      `cursor:${encodeURIComponent(params.cursor ?? 'first')}`,
      `limit:${params.limit}`,
      `search:${encodeURIComponent(params.search ?? '')}`,
      `category:${params.categoryId ?? ''}`,
      `categoryPath:${encodeURIComponent(params.categoryPath ?? '')}`,
      `vendor:${params.vendorId ?? ''}`,
      `inStock:${params.inStock ?? ''}`,
      `minPrice:${params.minPrice ?? ''}`,
      `maxPrice:${params.maxPrice ?? ''}`,
      `sort:${params.sort ?? 'newest'}`,
    ].join(':');
  }
}

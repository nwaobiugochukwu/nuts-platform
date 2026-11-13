import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';

import {
  PRODUCT_BY_SLUG,
  PRODUCT_TTL,
  VENDOR_STORE_PRODUCTS,
} from '@api/common/constants/cache.constant';

import { resolveCategoryIdFromPath } from '@api/common/utils/category-path.util';
import { mapPrismaError } from '@api/common/utils/prisma-error.util';
import { generateSlug } from '@api/common/utils/slug.util';
import { getStockStatus } from '@api/common/utils/stock-status.util';
import { computeVariantCombinations } from '@api/common/utils/variant-combinations.util';
import { normalizeOptions } from '@api/common/utils/variant-options.validator';

import { createPaginationMeta } from '@api/common/utils/pagination-meta.util';
import { getPagination } from '@api/common/utils/pagination.util';

import {
  buildCursorMeta,
  getCursorPagination,
  type CursorPayload,
} from '@api/common/utils/cursor-pagination.util';

import { AuditLogService } from '@api/common/audit-log/audit-log.service';
import { SearchService } from '@api/common/search/search.service';

import { AdminCreateProductDto } from './dto/admin-create-product.dto';
import { AdminProductResponseDto } from './dto/admin-product-response.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductCardDto } from './dto/product-card.dto';
import { ProductReactivateResponseDto } from './dto/product-reactivate-response.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { PublicProductResponseDto } from './dto/public-product-response.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { StockUpdateResponseDto } from './dto/stock-update-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { VendorProductResponseDto } from './dto/vendor-product-response.dto';

import type { CreateVariantDto } from '@api/modules/product-variants/dto/create-variant.dto';
import type { VariantSummaryDto } from '@api/modules/product-variants/dto/variant-response.dto';

/* ============================================================================
 * SHARED SELECTS
 * ========================================================================== */

/**
 * Flat category projection avoiding recursive N+1 relation queries.
 * Ancestor hierarchy is resolved in-memory via cached lookup map.
 */
export const categorySelect = {
  id: true,
  name: true,
  slug: true,
  parentId: true,
  path: true,
} as const;

export const categoryHierarchySelect = categorySelect;

export interface CategorySummaryRef {
  id: string;
  name: string;
  slug: string;
}

export type CategoryLookupMap = Map<
  string,
  { id: string; name: string; slug: string; parentId: string | null }
>;

interface CategoryHierarchyNode {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  parent?: CategoryHierarchyNode | null;
  parentCategory?: CategoryHierarchyNode | null;
}

export function resolveCategoryHierarchy(
  leafCategory: CategoryHierarchyNode | null | undefined,
  lookupMap?: CategoryLookupMap,
): {
  category: CategorySummaryRef;
  parentSubcategory?: CategorySummaryRef;
  subcategory?: CategorySummaryRef;
} {
  if (!leafCategory) {
    return {
      category: { id: '', name: '', slug: '' },
    };
  }

  const chain: CategorySummaryRef[] = [];
  let curr: CategoryHierarchyNode | null | undefined = leafCategory;

  // 1. If leafCategory already contains nested parent relation objects
  if (curr.parent || curr.parentCategory) {
    while (curr) {
      chain.unshift({
        id: curr.id,
        name: curr.name,
        slug: curr.slug,
      });
      curr = curr.parent ?? curr.parentCategory;
    }
  } else if (lookupMap && curr.id) {
    // 2. O(1) in-memory traversal using cached category lookup map (0 SQL queries)
    const visited = new Set<string>();
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      chain.unshift({
        id: curr.id,
        name: curr.name,
        slug: curr.slug,
      });
      if (!curr.parentId) break;
      curr = lookupMap.get(curr.parentId);
    }
  } else {
    // 3. Fallback: single leaf category node
    chain.push({
      id: curr.id,
      name: curr.name,
      slug: curr.slug,
    });
  }

  const root = chain[0] || {
    id: leafCategory.id || '',
    name: leafCategory.name || '',
    slug: leafCategory.slug || '',
  };

  const category: CategorySummaryRef = {
    id: root.id,
    name: root.name,
    slug: root.slug,
  };

  const result: {
    category: CategorySummaryRef;
    parentSubcategory?: CategorySummaryRef;
    subcategory?: CategorySummaryRef;
  } = { category };

  if (chain.length === 2) {
    result.subcategory = {
      id: chain[1].id,
      name: chain[1].name,
      slug: chain[1].slug,
    };
  } else if (chain.length >= 3) {
    const parentSub = chain[chain.length - 2];
    const leaf = chain[chain.length - 1];
    result.parentSubcategory = {
      id: parentSub.id,
      name: parentSub.name,
      slug: parentSub.slug,
    };
    result.subcategory = {
      id: leaf.id,
      name: leaf.name,
      slug: leaf.slug,
    };
  }

  return result;
}

/**
 * Variant fields required by product responses.
 *
 * createdAt / updatedAt are intentionally selected because the response DTO
 * exposes them. We never manufacture timestamps with `new Date()`.
 */
const variantSelect = {
  id: true,
  options: true,
  stock: true,
  images: true,
  isActive: true,
  isDeleted: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Admin variant select.
 *
 * Includes deletion metadata that is useful to administrators.
 */
const adminVariantSelect = {
  ...variantSelect,
  deletedAt: true,
} as const;

/**
 * Public variant select.
 *
 * This intentionally contains no internal-only deletion timestamp.
 */
const publicVariantSelect = {
  id: true,
  options: true,
  stock: true,
  images: true,
  isActive: true,
  isDeleted: true,
  createdAt: true,
  updatedAt: true,
} as const;

/* ============================================================================
 * PRISMA PAYLOAD TYPES
 * ========================================================================== */

type ProductWithCategory = Prisma.ProductGetPayload<{
  include: {
    category: { select: typeof categorySelect };
    images: {
      select: {
        id: true;
        url: true;
        position: true;
      };
    };
    vendor: {
      select: {
        id: true;
        storeName: true;
        storeSlug: true;
        storeLogoUrl: true;
      };
    };
    variants: {
      select: typeof variantSelect;
      where: {
        isDeleted: false;
      };
      orderBy: {
        createdAt: 'asc';
      };
    };
  };
}>;

type PublicProductWithCategory = Prisma.ProductGetPayload<{
  include: {
    category: { select: typeof categorySelect };
    images: {
      select: {
        id: true;
        url: true;
        position: true;
      };
    };
    vendor: {
      select: {
        id: true;
        storeName: true;
        storeSlug: true;
        storeLogoUrl: true;
        isVerified: true;
      };
    };
    variants: {
      select: typeof publicVariantSelect;
      where: {
        isDeleted: false;
        isActive: true;
      };
      orderBy: {
        createdAt: 'asc';
      };
    };
  };
}> & {
  vendor: {
    storeDescription?: string | null;
  };
};

type VendorProductWithCategory = Prisma.ProductGetPayload<{
  include: {
    category: { select: typeof categorySelect };
    images: {
      select: {
        id: true;
        url: true;
        position: true;
      };
    };
    vendor: {
      select: {
        id: true;
        storeName: true;
        storeSlug: true;
        storeLogoUrl: true;
      };
    };
    variants: {
      select: typeof publicVariantSelect;
      where: {
        isDeleted: false;
      };
      orderBy: {
        createdAt: 'asc';
      };
    };
  };
}>;

function productCursorFields(sort?: string) {
  switch (sort) {
    case 'price_asc':
      return [
        { field: 'price', direction: 'asc' as const },
        { field: 'id', direction: 'desc' as const },
      ];
    case 'price_desc':
      return [
        { field: 'price', direction: 'desc' as const },
        { field: 'id', direction: 'desc' as const },
      ];
    case 'oldest':
      return [
        { field: 'createdAt', direction: 'asc' as const },
        { field: 'id', direction: 'asc' as const },
      ];
    default:
      return [
        { field: 'createdAt', direction: 'desc' as const },
        { field: 'id', direction: 'desc' as const },
      ];
  }
}

function buildProductCursorWhere(
  cursor: CursorPayload,
  sort?: string,
): Prisma.ProductWhereInput[] {
  const fields = productCursorFields(sort);
  const expectedKeys = fields.map(({ field }) => field).sort();
  const cursorKeys = Object.keys(cursor).sort();
  const id = cursor.id;
  const primary = cursor[fields[0].field];

  if (
    cursorKeys.length !== expectedKeys.length ||
    cursorKeys.some((key, index) => key !== expectedKeys[index]) ||
    typeof id !== 'string' ||
    id.length === 0 ||
    (fields[0].field === 'createdAt' &&
      (!(primary instanceof Date) || !Number.isFinite(primary.getTime()))) ||
    (fields[0].field === 'price' &&
      ((typeof primary !== 'string' && typeof primary !== 'number') ||
        !Number.isFinite(Number(primary))))
  ) {
    throw new BadRequestException(
      'Invalid product cursor for the selected sort order.',
    );
  }

  return fields.map(({ field, direction }, index) => {
    const where: Record<string, unknown> = {};
    for (let previous = 0; previous < index; previous += 1) {
      const previousField = fields[previous].field;
      where[previousField] = cursor[previousField];
    }
    where[field] = {
      [direction === 'asc' ? 'gt' : 'lt']: cursor[field],
    };
    return where;
  });
}

function productCursorPayload(
  product: { id: string; createdAt: Date; price: Prisma.Decimal },
  sort?: string,
): CursorPayload {
  return sort === 'price_asc' || sort === 'price_desc'
    ? { price: product.price.toString(), id: product.id }
    : { createdAt: product.createdAt, id: product.id };
}

/* ============================================================================
 * SERVICE
 * ========================================================================== */

@Injectable()
export class ProductsService {
  /* --------------------------------------------------------------------------
   * Prisma relation selections
   * ------------------------------------------------------------------------ */

  /**
   * Full product selection used by admin/mutation operations.
   */
  private readonly productInclude = {
    category: {
      select: categorySelect,
    },

    images: {
      select: {
        id: true,
        url: true,
        position: true,
      },
      orderBy: {
        position: 'asc' as const,
      },
    },

    vendor: {
      select: {
        id: true,
        storeName: true,
        storeSlug: true,
        storeLogoUrl: true,
        isVerified: true,
      },
    },

    variants: {
      where: {
        isDeleted: false,
      },
      orderBy: {
        createdAt: 'asc' as const,
      },
      select: variantSelect,
    },
  } as const;

  /**
   * Public list selection.
   *
   * We still return variants because your existing PublicProductResponseDto
   * expects them, but we only retrieve active/non-deleted variants and the
   * first two product images.
   */
  private readonly publicListProductInclude = {
    category: {
      select: categorySelect,
    },

    images: {
      select: {
        id: true,
        url: true,
        position: true,
      },
      orderBy: {
        position: 'asc' as const,
      },
      take: 2,
    },

    vendor: {
      select: {
        id: true,
        storeName: true,
        storeSlug: true,
        storeLogoUrl: true,
        isVerified: true,
      },
    },

    variants: {
      where: {
        isDeleted: false,
        isActive: true,
      },
      orderBy: {
        createdAt: 'asc' as const,
      },
      select: publicVariantSelect,
    },
  } as const;

  /**
   * Public product detail selection.
   *
   * Full images and active variants are returned.
   */
  private readonly publicProductInclude = {
    category: {
      select: categorySelect,
    },

    images: {
      select: {
        id: true,
        url: true,
        position: true,
      },
      orderBy: {
        position: 'asc' as const,
      },
    },

    vendor: {
      select: {
        id: true,
        storeName: true,
        storeSlug: true,
        storeLogoUrl: true,
        storeDescription: true,
        isVerified: true,
      },
    },

    variants: {
      where: {
        isDeleted: false,
        isActive: true,
      },
      orderBy: {
        createdAt: 'asc' as const,
      },
      select: publicVariantSelect,
    },
  } as const;

  /**
   * Vendor selection.
   *
   * Deleted variants remain visible to the vendor because this is their
   * management view.
   */
  private readonly vendorProductInclude = {
    category: {
      select: categorySelect,
    },

    images: {
      select: {
        id: true,
        url: true,
        position: true,
      },
      orderBy: {
        position: 'asc' as const,
      },
    },

    vendor: {
      select: {
        id: true,
        storeName: true,
        storeSlug: true,
        storeLogoUrl: true,
      },
    },

    variants: {
      where: {
        isDeleted: false,
      },
      orderBy: {
        createdAt: 'asc' as const,
      },
      select: publicVariantSelect,
    },
  } as const;

  /**
   * Admin listing selection.
   *
   * Includes deletion metadata and variant timestamps.
   */
  private readonly adminListInclude = {
    category: {
      select: categorySelect,
    },

    images: {
      select: {
        id: true,
        url: true,
        position: true,
      },
      orderBy: {
        position: 'asc' as const,
      },
    },

    vendor: {
      select: {
        id: true,
        storeName: true,
        storeSlug: true,
        storeLogoUrl: true,
      },
    },

    variants: {
      where: {
        isDeleted: false,
      },
      orderBy: {
        createdAt: 'asc' as const,
      },
      select: adminVariantSelect,
    },
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly searchService: SearchService,
    private readonly auditLog: AuditLogService,
  ) {}

  private categoryLookupCache: {
    map: CategoryLookupMap;
    expiresAt: number;
  } | null = null;

  /**
   * Cached map of all active categories for O(1) in-memory ancestor resolution.
   * Eliminates recursive N+1 database queries when rendering product lists.
   */
  async getCategoryLookupMap(): Promise<CategoryLookupMap> {
    if (
      this.categoryLookupCache &&
      this.categoryLookupCache.expiresAt > Date.now()
    ) {
      return this.categoryLookupCache.map;
    }

    const cacheKey = 'categories:lookup:map:v2';
    const list = await this.cacheService.wrap(cacheKey, 300, async () => {
      return this.prisma.category.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
        },
      });
    });

    const map: CategoryLookupMap = new Map();
    if (Array.isArray(list)) {
      for (const cat of list) {
        map.set(cat.id, cat);
      }
    }

    this.categoryLookupCache = {
      map,
      expiresAt: Date.now() + 60_000,
    };

    return map;
  }

  /* ==========================================================================
   * CREATE
   * ======================================================================== */

  /**
   * Create a product through the admin API.
   */
  async create(
    dto: AdminCreateProductDto,
    adminId?: string,
  ): Promise<ProductResponseDto> {
    if (!dto.vendorId) {
      throw new BadRequestException(
        'vendorId is required when creating a product through admin API',
      );
    }

    const categoryId = await this.resolveCategoryId(dto.categoryId);

    /*
     * Slugs are scoped to the category in this implementation.
     *
     * IMPORTANT:
     * The database must still have a unique constraint such as:
     *
     * @@unique([categoryId, slug])
     *
     * because application-level slug checking cannot completely prevent
     * concurrent requests from generating the same slug.
     */
    const slug = await this.resolveProductSlug(dto.name, categoryId, dto.slug);

    try {
      const imageUrls = this.normalizeImageUrls(dto.imageUrls, dto.imageUrl);

      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,

          hasVariants: dto.hasVariants ?? false,

          /*
           * A variant product does not maintain product-level stock.
           * Its stock is calculated from its variants.
           */
          stock: dto.hasVariants ? 0 : (dto.stock ?? 0),

          price: dto.price ?? 0,

          sku: dto.sku,
          isActive: dto.isActive ?? true,

          categoryId,
          vendorId: dto.vendorId,

          images:
            imageUrls.length > 0
              ? {
                  create: imageUrls.map((url, index) => ({
                    url,
                    position: index,
                    isPrimary: index === 0,
                  })),
                }
              : undefined,
        },

        include: this.productInclude,
      });

      if (dto.hasVariants && dto.variants && dto.variants.length > 0) {
        await this.createInitialVariants(product.id, dto.variants);
      }

      const freshProduct =
        dto.hasVariants && dto.variants && dto.variants.length > 0
          ? await this.prisma.product.findUnique({
              where: { id: product.id },
              include: this.productInclude,
            })
          : product;

      const response = this.toResponse(freshProduct || product);

      /*
       * Product creation invalidates:
       * - exact product cache
       * - public product listings
       * - vendor store listing
       */
      await this.invalidateProductCaches({
        id: product.id,
        slugs: [product.slug],
        vendorStoreSlug: product.vendor.storeSlug,
      });

      await this.auditLog.log({
        action: 'CREATE_PRODUCT',
        entity: 'Product',
        entityId: product.id,
        adminId,
        payload: {
          name: product.name,
          sku: product.sku,
          vendorId: product.vendor.id,
        },
      });

      return response;
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /**
   * Create a product from a vendor account.
   */
  async createForVendor(
    vendorId: string,
    dto: CreateProductDto,
  ): Promise<VendorProductResponseDto> {
    const categoryId = await this.resolveCategoryId(dto.categoryId);

    const slug = await this.resolveProductSlug(dto.name, categoryId, dto.slug);

    try {
      const imageUrls = this.normalizeImageUrls(dto.imageUrls, dto.imageUrl);

      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,

          hasVariants: dto.hasVariants ?? false,
          stock: dto.hasVariants ? 0 : (dto.stock ?? 0),
          price: dto.price ?? 0,

          sku: dto.sku,
          isActive: dto.isActive ?? true,

          categoryId,
          vendorId,

          images:
            imageUrls.length > 0
              ? {
                  create: imageUrls.map((url, index) => ({
                    url,
                    position: index,
                    isPrimary: index === 0,
                  })),
                }
              : undefined,
        },

        include: this.vendorProductInclude,
      });

      if (dto.hasVariants && dto.variants && dto.variants.length > 0) {
        await this.createInitialVariants(product.id, dto.variants);
      }

      const freshProduct =
        dto.hasVariants && dto.variants && dto.variants.length > 0
          ? await this.prisma.product.findUnique({
              where: { id: product.id },
              include: this.vendorProductInclude,
            })
          : product;

      const response = this.toVendorResponse(freshProduct || product);

      await this.invalidateProductCaches({
        id: product.id,
        slugs: [product.slug],
        vendorStoreSlug: product.vendor.storeSlug,
      });

      await this.auditLog.log({
        action: 'CREATE_PRODUCT',
        entity: 'Product',
        entityId: product.id,
        adminId: vendorId,
        userId: vendorId,
        payload: {
          name: product.name,
          sku: product.sku,
          vendorId,
        },
      });

      return response;
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /* ==========================================================================
   * PUBLIC READS
   * ======================================================================== */

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

    const search = this.normalizeSearch(params.search);

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
            include: this.publicListProductInclude,
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

          const categoryMap = await this.getCategoryLookupMap();

          const response = {
            data: orderedProducts.map((product) =>
              this.toCardResponse(product, categoryMap),
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
          include: this.publicListProductInclude,
          orderBy: this.resolveProductOrderBy(params.sort),
          ...getPagination(page, limit),
        }),

        this.getCategoryLookupMap(),
      ]);

      const response = {
        data: products.map((product) =>
          this.toCardResponse(product, categoryMap),
        ),
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

    const search = this.normalizeSearch(params.search);

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
          include: this.publicListProductInclude,
          orderBy: this.resolveProductOrderBy(params.sort),
          take,
        }),
        this.getCategoryLookupMap(),
      ]);

      const meta = buildCursorMeta(products, limit, (last) =>
        productCursorPayload(last, params.sort),
      );

      const response = {
        data: products
          .slice(0, limit)
          .map((product) => this.toCardResponse(product, categoryMap)),
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
          include: this.publicProductInclude,
        }),
        this.getCategoryLookupMap(),
      ]);

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      return this.toPublicResponse(product, true, categoryMap);
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
      ? await this.collectCategoryAndDescendantIds(params.categoryId)
      : undefined;
    const search = this.normalizeSearch(params.search);
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
          include: this.publicListProductInclude,
        });

        const productMap = new Map(fetched.map((p) => [p.id, p]));
        products = topProductIds
          .map((id) => productMap.get(id))
          .filter((p): p is PublicProductWithCategory => p !== undefined);
      }

      const unitsSoldByProduct = new Map(
        topSales.map((sale) => [
          sale.productId,
          Number(sale._sum.quantity ?? 0),
        ]),
      );

      return products.map((product) => {
        const unitsSold = unitsSoldByProduct.get(product.id) ?? 0;
        return {
          ...this.toCardResponse(product),
          recommendationReason: `${unitsSold} sold in the last ${days} days`,
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
      include: this.publicListProductInclude,
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const categoryMap = await this.getCategoryLookupMap();
    return uniqueIds
      .map((id) => byId.get(id))
      .filter((product): product is PublicProductWithCategory =>
        Boolean(product),
      )
      .map((product) => this.toCardResponse(product, categoryMap));
  }

  /* ==========================================================================
   * VENDOR READS
   * ======================================================================== */

  /**
   * Returns the authenticated vendor's products.
   */
  async findAllForVendor(
    vendorId: string,
    query: QueryProductDto,
  ): Promise<{
    data: VendorProductResponseDto[];
    meta: ReturnType<typeof createPaginationMeta>;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 10), 50);

    const where = await this.buildListWhere(query, {
      vendorId,
      defaultDeleted: false,
    });

    const [total, products, categoryMap] = await Promise.all([
      this.prisma.product.count({
        where,
      }),

      this.prisma.product.findMany({
        where,
        include: this.vendorProductInclude,
        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        ...getPagination(page, limit),
      }),

      this.getCategoryLookupMap(),
    ]);

    return {
      data: products.map((product) =>
        this.toVendorResponse(product, categoryMap),
      ),
      meta: createPaginationMeta(total, page, limit),
    };
  }

  /**
   * Retrieves a product only when it belongs to the vendor.
   *
   * Ownership is enforced in SQL rather than fetching first and checking
   * ownership afterwards.
   */
  async findOneForVendor(
    slug: string,
    vendorId: string,
  ): Promise<VendorProductResponseDto> {
    const product = await this.prisma.product.findFirst({
      where: {
        slug: slug.trim(),
        vendorId,
        isDeleted: false,
      },
      include: this.vendorProductInclude,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.toVendorResponse(product);
  }

  /* ==========================================================================
   * ADMIN READS
   * ======================================================================== */

  /**
   * Admin product listing.
   *
   * Supports both:
   * - cursor pagination
   * - traditional page pagination
   */
  async findAllForAdmin(query: QueryProductDto): Promise<{
    data: AdminProductResponseDto[];
    meta:
      | ReturnType<typeof createPaginationMeta>
      | ReturnType<typeof buildCursorMeta>;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 10), 100);

    const where = await this.buildListWhere(query, {
      /*
       * Admin listing defaults to non-deleted products unless the caller
       * explicitly requests another value through isDeleted.
       */
      defaultDeleted: false,
    });

    /* ------------------------------------------------------------------------
     * Cursor pagination
     * ---------------------------------------------------------------------- */

    if (query.cursor !== undefined) {
      const { take, decodedCursor } = getCursorPagination(limit, query.cursor);
      if (!decodedCursor) {
        throw new BadRequestException('Invalid product cursor.');
      }

      if (decodedCursor) {
        const cursorWhere = buildProductCursorWhere(decodedCursor, query.sort);

        /*
         * FIXED:
         *
         * The old implementation spread an array into `where`.
         *
         * Cursor conditions must be placed inside AND.
         */
        const existingAnd = Array.isArray(where.AND)
          ? where.AND
          : where.AND
            ? [where.AND]
            : [];

        where.AND = [...existingAnd, { OR: cursorWhere }];
      }

      const [products, categoryMap] = await Promise.all([
        this.prisma.product.findMany({
          where,
          include: this.adminListInclude,
          orderBy: this.resolveProductOrderBy(query.sort),
          take,
        }),
        this.getCategoryLookupMap(),
      ]);

      const meta = buildCursorMeta(products, limit, (last) =>
        productCursorPayload(last, query.sort),
      );

      return {
        data: products
          .slice(0, limit)
          .map((product) => this.toAdminResponse(product, categoryMap)),
        meta,
      };
    }

    /* ------------------------------------------------------------------------
     * Traditional pagination
     * ---------------------------------------------------------------------- */

    const [total, products, categoryMap] = await Promise.all([
      this.prisma.product.count({
        where,
      }),

      this.prisma.product.findMany({
        where,
        include: this.adminListInclude,
        orderBy: this.resolveProductOrderBy(query.sort),
        ...getPagination(page, limit),
      }),

      this.getCategoryLookupMap(),
    ]);

    return {
      data: products.map((product) =>
        this.toAdminResponse(product, categoryMap),
      ),
      meta: createPaginationMeta(total, page, limit),
    };
  }

  /**
   * Admin lookup by product ID.
   *
   * Unlike public/vendor reads, deleted and inactive products are allowed.
   */
  async findOneForAdmin(id: string): Promise<AdminProductResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: {
        id,
      },
      include: this.productInclude,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.toAdminResponse(product);
  }

  /**
   * Returns stock adjustment history.
   */
  async getStockHistory(productId: string, take = 50) {
    const safeTake = Math.min(Math.max(1, take), 100);

    const product = await this.prisma.product.findUnique({
      where: {
        id: productId,
      },
      select: {
        id: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const history = await this.prisma.stockHistory.findMany({
      where: {
        productId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: safeTake,
    });

    return history.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      adjustment: item.adjustment,
      oldStockQuantity: item.oldStockQuantity,
      newStockQuantity: item.newStockQuantity,
      description: item.description,
      createdAt: item.createdAt,
    }));
  }

  /* ==========================================================================
   * STOCK
   * ======================================================================== */

  /**
   * Atomically adjusts product-level stock and writes the stock history entry
   * in the SAME transaction.
   *
   * Variant products are rejected because their stock belongs to variants.
   */
  async updateStock(
    id: string,
    quantity: number,
    userId?: string,
    description?: string,
  ): Promise<StockUpdateResponseDto> {
    if (!Number.isInteger(quantity)) {
      throw new BadRequestException(
        'Stock adjustment quantity must be an integer',
      );
    }

    /*
     * The adjustment of zero is technically harmless, but treating it as a
     * no-op prevents unnecessary DB writes and audit records.
     */
    if (quantity === 0) {
      const product = await this.prisma.product.findFirst({
        where: {
          id,
          isDeleted: false,
        },
        select: {
          id: true,
          slug: true,
          stock: true,
          updatedAt: true,
          hasVariants: true,
        },
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      if (product.hasVariants) {
        throw new BadRequestException(
          'Stock is managed at the variant level for variant products. Use the variant stock endpoint instead.',
        );
      }

      const { inStock, stockStatus } = getStockStatus(product.stock, true);

      return {
        id: product.id,
        slug: product.slug,
        stock: product.stock,
        inStock,
        stockStatus,
        updatedAt: product.updatedAt,
      };
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        /*
         * Fetch only fields required for validation.
         */
        const product = await tx.product.findFirst({
          where: {
            id,
            isDeleted: false,
          },
          select: {
            id: true,
            slug: true,
            stock: true,
            hasVariants: true,
            vendor: {
              select: {
                storeSlug: true,
              },
            },
          },
        });

        if (!product) {
          throw new NotFoundException('Product not found');
        }

        if (product.hasVariants) {
          throw new BadRequestException(
            'Stock is managed at the variant level for variant products. Use the variant stock endpoint instead.',
          );
        }

        /*
         * The UPDATE is guarded when decreasing stock.
         *
         * This prevents:
         *
         * currentStock = 2
         * quantity = -5
         *
         * from ever producing -3.
         *
         * The database performs the increment/decrement atomically.
         */
        const updatedCount = await tx.product.updateMany({
          where: {
            id,
            isDeleted: false,

            ...(quantity < 0
              ? {
                  stock: {
                    gte: -quantity,
                  },
                }
              : {}),
          },

          data: {
            stock: {
              increment: quantity,
            },
          },
        });

        if (updatedCount.count !== 1) {
          throw new BadRequestException(
            `Insufficient stock: cannot apply ${quantity} to the current stock level`,
          );
        }

        /*
         * This SELECT occurs inside the same transaction after the atomic
         * update. The returned stock is therefore the value produced by
         * this adjustment.
         */
        const updated = await tx.product.findUniqueOrThrow({
          where: {
            id,
          },
          select: {
            id: true,
            slug: true,
            stock: true,
            updatedAt: true,
          },
        });

        /*
         * Deriving oldStock from the resulting value + adjustment avoids
         * relying on a stale pre-transaction read.
         *
         * newStock = oldStock + quantity
         * oldStock = newStock - quantity
         */
        const oldStock = updated.stock - quantity;

        await tx.stockHistory.create({
          data: {
            productId: id,
            adjustment: quantity,
            oldStockQuantity: oldStock,
            newStockQuantity: updated.stock,
            description:
              description ??
              (quantity > 0
                ? 'Manual stock adjustment'
                : 'Manual stock reduction'),
          },
        });

        return {
          product,
          updated,
          oldStock,
        };
      });

      const { updated, oldStock, product } = result;

      const { inStock, stockStatus } = getStockStatus(updated.stock, true);

      const response: StockUpdateResponseDto = {
        id: updated.id,
        slug: updated.slug,
        stock: updated.stock,
        inStock,
        stockStatus,
        updatedAt: updated.updatedAt,
      };

      /*
       * Cache invalidation happens AFTER the transaction has committed.
       *
       * This prevents invalidating caches for a DB operation that later rolls
       * back.
       */
      await this.invalidateProductCaches({
        id: updated.id,
        slugs: [updated.slug],
        vendorStoreSlug: product.vendor?.storeSlug,
      });

      await this.auditLog.log({
        action: 'UPDATE_PRODUCT_STOCK',
        entity: 'Product',
        entityId: id,
        adminId: userId,
        userId,
        payload: {
          previousStock: oldStock,
          newStock: updated.stock,
          adjustment: quantity,
        },
      });

      return response;
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /* ==========================================================================
   * UPDATE
   * ======================================================================== */

  /**
   * Updates an existing product.
   *
   * Handles:
   * - category validation
   * - category changes
   * - slug regeneration
   * - slug uniqueness
   * - variant/product stock rules
   * - primary image replacement
   * - cache invalidation
   * - audit logging
   */
  async update(
    id: string,
    dto: UpdateProductDto,
    userId?: string,
  ): Promise<AdminProductResponseDto> {
    const existing = await this.findActiveProductOrThrow(id);

    const {
      slug: slugInput,
      name,
      imageUrl,
      imageUrls,
      variants,
      categoryId: nextCategoryId,
      ...rest
    } = dto;
    void variants;

    const data: Prisma.ProductUpdateInput = {
      ...rest,
    };

    /*
     * Keep track of the ACTUAL category that the resulting product will use.
     *
     * This is important because slug uniqueness is scoped to category.
     */
    let resolvedCategoryId = existing.categoryId;

    /* ------------------------------------------------------------------------
     * Category
     * ---------------------------------------------------------------------- */

    if (
      nextCategoryId !== undefined &&
      nextCategoryId !== existing.categoryId
    ) {
      resolvedCategoryId = await this.resolveCategoryId(nextCategoryId);

      data.category = {
        connect: {
          id: resolvedCategoryId,
        },
      };
    }

    /* ------------------------------------------------------------------------
     * Variant stock rules
     * ---------------------------------------------------------------------- */

    /*
     * Once a product becomes a variant product, its direct stock must be zero.
     */
    if (dto.hasVariants === true && !existing.hasVariants) {
      data.stock = 0;
    }

    /*
     * Prevent accidentally leaving product-level stock active when an existing
     * variant product remains a variant product.
     */
    if (
      dto.hasVariants === true ||
      (dto.hasVariants === undefined && existing.hasVariants)
    ) {
      data.stock = 0;
    }

    /* ------------------------------------------------------------------------
     * Slug
     * ---------------------------------------------------------------------- */

    let nextSlug: string | undefined;

    /*
     * Explicit slug supplied.
     */
    if (slugInput?.trim()) {
      nextSlug = await this.resolveProductSlug(
        name ?? existing.name,
        resolvedCategoryId,
        slugInput,
        id,
      );
    } else if (name !== undefined || nextCategoryId !== undefined) {
      /*
       * Name changed without an explicit slug.
       *
       * Generate a new slug from the new name.
       */
      nextSlug = await this.resolveProductSlug(
        name ?? existing.name,
        resolvedCategoryId,
        undefined,
        id,
      );
    }

    if (nextSlug !== undefined) {
      data.slug = nextSlug;
    }

    /* ------------------------------------------------------------------------
     * Primary image & Image list order
     * ---------------------------------------------------------------------- */

    if (imageUrls !== undefined) {
      const normalizedImages = this.normalizeImageUrls(imageUrls, imageUrl);

      // Remove existing non-variant images so the new order/selection applies
      await this.prisma.productImage.deleteMany({
        where: {
          productId: id,
          variantId: null,
        },
      });

      if (normalizedImages.length > 0) {
        data.images = {
          create: normalizedImages.map((url, index) => ({
            url,
            position: index,
            isPrimary: index === 0,
          })),
        };
      }
    } else if (imageUrl !== undefined) {
      data.images = {
        updateMany: {
          where: {
            isPrimary: true,
          },
          data: {
            isPrimary: false,
          },
        },

        create: {
          url: imageUrl,
          isPrimary: true,
          position: 0,
        },
      };
    }

    try {
      const updated = await this.prisma.product.update({
        where: {
          id,
        },
        data,
        include: this.productInclude,
      });

      const response = this.toAdminResponse(updated);

      /*
       * Invalidate BOTH old and new slug caches when the slug changes.
       */
      const slugsToInvalidate =
        updated.slug !== existing.slug
          ? [existing.slug, updated.slug]
          : [updated.slug];

      await this.invalidateProductCaches({
        id: updated.id,
        slugs: slugsToInvalidate,
        vendorStoreSlug: updated.vendor.storeSlug,
      });

      await this.auditLog.log({
        action: 'UPDATE_PRODUCT',
        entity: 'Product',
        entityId: id,
        adminId: userId,
        userId,
        payload: {
          changes: JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonValue,
        },
      });

      return response;
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /* ==========================================================================
   * STATUS
   * ======================================================================== */

  /**
   * Soft-deactivates a product.
   */
  async deactivate(id: string, userId?: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        slug: true,
        isActive: true,
        vendor: {
          select: {
            storeSlug: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    /*
     * Idempotent operation:
     * if already inactive, no unnecessary DB update occurs.
     */
    if (product.isActive) {
      await this.prisma.product.updateMany({
        where: {
          id,
          isDeleted: false,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });
    }

    await this.invalidateProductCaches({
      id: product.id,
      slugs: [product.slug],
      vendorStoreSlug: product.vendor?.storeSlug,
    });

    await this.auditLog.log({
      action: 'DEACTIVATE_PRODUCT',
      entity: 'Product',
      entityId: id,
      adminId: userId,
      userId,
      payload: {
        name: product.name,
        sku: product.sku,
      },
    });
  }

  /**
   * Reactivates a product.
   *
   * A deleted product is not restored by this method; restore() handles
   * soft-deleted products.
   */
  async reactivate(
    id: string,
    userId?: string,
  ): Promise<ProductReactivateResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        isDeleted: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.isDeleted) {
      throw new BadRequestException(
        'Deleted products must be restored before they can be activated',
      );
    }

    const updated = await this.prisma.product.update({
      where: {
        id,
      },
      data: {
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
        isActive: true,
        updatedAt: true,
        vendor: {
          select: {
            storeSlug: true,
          },
        },
      },
    });

    await this.invalidateProductCaches({
      id: updated.id,
      slugs: [updated.slug],
      vendorStoreSlug: updated.vendor?.storeSlug,
    });

    await this.auditLog.log({
      action: 'REACTIVATE_PRODUCT',
      entity: 'Product',
      entityId: id,
      adminId: userId,
      userId,
      payload: {
        name: product.name,
        sku: product.sku,
      },
    });

    return updated;
  }

  /**
   * Permanently deletes a product.
   *
   * Foreign-key failures are mapped through mapPrismaError().
   */
  async permanentRemove(id: string, userId?: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        slug: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    try {
      await this.prisma.product.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      mapPrismaError(error);
    }

    await this.invalidateProductCaches({
      id: product.id,
      slugs: [product.slug],
    });

    await this.auditLog.log({
      action: 'PERMANENT_DELETE_PRODUCT',
      entity: 'Product',
      entityId: id,
      adminId: userId,
      userId,
      payload: {
        name: product.name,
        sku: product.sku,
      },
    });
  }

  /**
   * Restores a soft-deleted product.
   */
  async restore(id: string, userId?: string): Promise<ProductResponseDto> {
    const existing = await this.prisma.product.findUnique({
      where: {
        id,
      },
    });

    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (!existing.isDeleted) {
      throw new BadRequestException('Product is not deleted');
    }

    /*
     * Re-check slug uniqueness because another product could have occupied
     * the old category/slug combination while this product was deleted.
     */
    const slug = await this.resolveProductSlug(
      existing.name,
      existing.categoryId,
      existing.slug,
      existing.id,
    );

    try {
      const updated = await this.prisma.product.update({
        where: {
          id,
        },
        data: {
          slug,
          isDeleted: false,
          isActive: true,
          deletedAt: null,
        },
        include: this.productInclude,
      });

      const response = this.toResponse(updated);

      await this.invalidateProductCaches({
        id: updated.id,
        slugs: [existing.slug, updated.slug],
        vendorStoreSlug: updated.vendor.storeSlug,
      });

      await this.auditLog.log({
        action: 'RESTORE_PRODUCT',
        entity: 'Product',
        entityId: id,
        adminId: userId,
        userId,
        payload: {
          name: existing.name,
          sku: existing.sku,
        },
      });

      return response;
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /* ==========================================================================
   * LEGACY METHODS
   * ======================================================================== */

  /**
   * @deprecated Use findOnePublic(slug) for public slug lookup.
   */
  async findOne(id: string): Promise<ProductResponseDto> {
    const cacheKey = `product:id:${id}`;

    const cached = await this.cacheService.get<ProductResponseDto>(cacheKey);

    if (cached) {
      return cached;
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id,
        isDeleted: false,
        isActive: true,
      },
      include: this.productInclude,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const response = this.toResponse(product);

    /*
     * Keep the old ID cache and slug cache populated for backwards
     * compatibility with existing consumers.
     */
    await Promise.all([
      this.cacheService.set(cacheKey, response, PRODUCT_TTL),

      this.cacheService.set(
        `product:slug:${product.slug}`,
        response,
        PRODUCT_TTL,
      ),
    ]);

    return response;
  }

  /**
   * @deprecated Use findOnePublic().
   */
  async findBySlug(slug: string) {
    return this.findOnePublic(slug);
  }

  /**
   * @deprecated Use findOneForVendor().
   */
  async findBySlugForVendor(
    vendorId: string,
    slug: string,
  ): Promise<ProductResponseDto> {
    return this.findOneForVendor(
      slug,
      vendorId,
    ) as unknown as Promise<ProductResponseDto>;
  }

  /**
   * @deprecated Use findAllForAdmin().
   */
  async findAll(query: QueryProductDto): Promise<{
    data: AdminProductResponseDto[];
    meta:
      | ReturnType<typeof createPaginationMeta>
      | ReturnType<typeof buildCursorMeta>;
  }> {
    return this.findAllForAdmin(query);
  }

  /**
   * @deprecated Use findAllForVendor().
   */
  async findAllByVendor(
    vendorId: string,
    query: QueryProductDto,
  ): Promise<{
    data: VendorProductResponseDto[];
    meta: ReturnType<typeof createPaginationMeta>;
  }> {
    return this.findAllForVendor(vendorId, query);
  }

  /* ==========================================================================
   * PRIVATE PRODUCT HELPERS
   * ======================================================================== */

  /**
   * Creates initial variants for a product during creation.
   */
  private async createInitialVariants(
    productId: string,
    variants: CreateVariantDto[],
  ): Promise<void> {
    for (const variant of variants) {
      const names = new Set<string>();
      const normalized = (variant.options || [])
        .map((opt) => {
          const name = opt.name?.trim();
          const value = opt.value?.trim();
          if (!name || names.has(name)) return null;
          names.add(name);
          return { name, value };
        })
        .filter((o): o is { name: string; value: string } =>
          Boolean(o && o.name && o.value),
        )
        .sort((a, b) => a.name.localeCompare(b.name));

      if (normalized.length === 0) continue;

      const optionsKey = normalized
        .map((opt) => `${opt.name}:${opt.value}`)
        .join('|');

      try {
        await this.prisma.productVariant.create({
          data: {
            productId,
            options: normalized,
            optionsKey,
            stock: Math.max(0, Number(variant.stock) || 0),
            images: Array.isArray(variant.images)
              ? variant.images.filter(Boolean)
              : [],
          },
        });
      } catch {
        // Skip duplicate variant option keys gracefully
      }
    }
  }

  /**
   * Finds a non-deleted product.
   */
  private async findActiveProductOrThrow(id: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        isDeleted: false,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  /**
   * Normalizes and caps product image URLs.
   */
  private normalizeImageUrls(
    imageUrls?: string[],
    imageUrl?: string,
  ): string[] {
    const urls = imageUrls?.length ? imageUrls : imageUrl ? [imageUrl] : [];

    return [
      ...new Set(
        urls
          .map((url) => url?.trim())
          .filter((url): url is string => Boolean(url)),
      ),
    ].slice(0, 6);
  }

  /**
   * Normalizes search input.
   */
  private normalizeSearch(search?: string): string | undefined {
    const normalized = search?.trim();

    return normalized || undefined;
  }

  /* ==========================================================================
   * RESPONSE MAPPERS
   * ======================================================================== */

  /**
   * Calculates total available stock.
   *
   * Product-level stock is authoritative for normal products.
   * Variant stock is authoritative for variant products.
   */
  private computeTotalStock(
    hasVariants: boolean,
    stock: number,
    variants: Array<{
      stock: number;
    }>,
  ): number {
    if (!hasVariants) {
      return stock;
    }

    return variants.reduce((total, variant) => total + variant.stock, 0);
  }

  /**
   * Maps the internal product representation to the legacy/full response DTO.
   */
  private toResponse(product: ProductWithCategory): ProductResponseDto {
    const totalStock = this.computeTotalStock(
      product.hasVariants,
      product.stock,
      product.variants,
    );

    const { inStock, stockStatus } = getStockStatus(
      totalStock,
      product.isActive && !product.isDeleted,
    );

    const images = product.images.map((image) => ({
      id: image.id,
      url: image.url,

      /*
       * IMPORTANT:
       *
       * If ProductImage has an actual `publicId` column, add it to the
       * Prisma select and return it here.
       *
       * Do not pretend the URL is the Cloudinary/public ID.
       */
      publicId: image.url,

      position: image.position,
      isCover: image.position === 0,
    }));

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      sku: product.sku,

      hasVariants: product.hasVariants,

      price: Number(product.price),

      stock: totalStock,
      inStock,
      stockStatus,

      variants: product.variants.map((variant) =>
        this.toVariantSummaryDto(variant),
      ),

      variantCombinations:
        product.variants.length > 0
          ? computeVariantCombinations(product.variants)
          : undefined,

      vendor: {
        id: product.vendor.id,
        storeName: product.vendor.storeName,
        storeSlug: product.vendor.storeSlug,
        storeLogoUrl: product.vendor.storeLogoUrl,
      },

      ...resolveCategoryHierarchy(product.category),

      imageUrl: product.images[0]?.url ?? null,

      images,

      isActive: product.isActive,

      createdAt: product.createdAt,

      updatedAt: product.updatedAt,
    };
  }

  /**
   * Maps lightweight public product card response for catalog grids.
   */
  private toCardResponse(
    product: PublicProductWithCategory,
    categoryMap?: CategoryLookupMap,
  ): ProductCardDto {
    const totalStock = this.computeTotalStock(
      product.hasVariants,
      product.stock,
      product.variants,
    );

    const { stockStatus } = getStockStatus(
      totalStock,
      product.isActive && !product.isDeleted,
    );

    const coverImage =
      product.images.find((img) => img.position === 0) || product.images[0];

    const hierarchy = resolveCategoryHierarchy(product.category, categoryMap);

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      hasVariants: product.hasVariants,
      price: Number(product.price),
      discountPrice: null,
      thumbnail: coverImage?.url ?? null,
      stockStatus,
      categoryId: hierarchy.category?.id || product.categoryId || null,
      category: hierarchy.category?.id ? hierarchy.category : null,
      parentSubcategory: hierarchy.parentSubcategory || null,
      subcategory: hierarchy.subcategory || null,
      vendor: {
        id: product.vendor.id,
        storeName: product.vendor.storeName,
        storeSlug: product.vendor.storeSlug,
        storeLogoUrl: product.vendor.storeLogoUrl ?? undefined,
        isVerified: product.vendor.isVerified,
      },
    };
  }

  /**
   * Maps public product response.
   */
  private toPublicResponse(
    product: PublicProductWithCategory,
    includeCombinations = true,
    categoryMap?: CategoryLookupMap,
  ): PublicProductResponseDto {
    const totalStock = this.computeTotalStock(
      product.hasVariants,
      product.stock,
      product.variants,
    );

    const { inStock, stockStatus } = getStockStatus(
      totalStock,
      product.isActive && !product.isDeleted,
    );

    const images = product.images.map((image) => ({
      url: image.url,

      /*
       * Replace this with the actual storage publicId if your schema has
       * one. Never use URL as a fake publicId long-term.
       */
      publicId: image.url,

      isCover: image.position === 0,
    }));

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      sku: product.sku,

      hasVariants: product.hasVariants,

      price: Number(product.price),

      stock: totalStock,
      discountPrice: undefined,
      salePercentage: 0,

      inStock,
      stockStatus,

      variants: product.variants.map((variant) =>
        this.toVariantSummaryDto(variant),
      ),

      variantCombinations:
        includeCombinations && product.variants.length > 0
          ? computeVariantCombinations(product.variants)
          : undefined,

      vendor: {
        id: product.vendor.id,
        storeName: product.vendor.storeName,
        storeSlug: product.vendor.storeSlug,
        storeLogoUrl: product.vendor.storeLogoUrl,
        storeDescription: product.vendor.storeDescription ?? undefined,
      },

      ...resolveCategoryHierarchy(product.category, categoryMap),

      imageUrl: product.images[0]?.url ?? null,

      images,

      isActive: product.isActive,

      createdAt: product.createdAt,

      updatedAt: product.updatedAt,
    };
  }

  /**
   * Maps vendor product response.
   */
  private toVendorResponse(
    product: VendorProductWithCategory,
    categoryMap?: CategoryLookupMap,
  ): VendorProductResponseDto {
    const totalStock = this.computeTotalStock(
      product.hasVariants,
      product.stock,
      product.variants,
    );

    const { inStock, stockStatus } = getStockStatus(
      totalStock,
      product.isActive && !product.isDeleted,
    );

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      sku: product.sku,

      hasVariants: product.hasVariants,

      price: Number(product.price),

      stock: totalStock,
      inStock,
      stockStatus,

      variants: product.variants.map((variant) =>
        this.toVariantSummaryDto(variant),
      ),

      variantCombinations:
        product.variants.length > 0
          ? computeVariantCombinations(product.variants)
          : undefined,

      ...resolveCategoryHierarchy(product.category, categoryMap),

      images: product.images.map((image) => ({
        id: image.id,
        url: image.url,
        publicId: image.url,
        position: image.position,
        isCover: image.position === 0,
      })),

      isActive: product.isActive,

      isDeleted: product.isDeleted,

      deletedAt: product.deletedAt ?? null,

      createdAt: product.createdAt,

      updatedAt: product.updatedAt,
    };
  }

  /**
   * Maps admin product response.
   */
  private toAdminResponse(
    product: ProductWithCategory,
    categoryMap?: CategoryLookupMap,
  ): AdminProductResponseDto {
    const totalStock = this.computeTotalStock(
      product.hasVariants,
      product.stock,
      product.variants,
    );

    const { inStock, stockStatus } = getStockStatus(
      totalStock,
      product.isActive && !product.isDeleted,
    );

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      sku: product.sku,

      hasVariants: product.hasVariants,

      price: Number(product.price),

      stock: totalStock,
      inStock,
      stockStatus,

      variants: product.variants.map((variant) =>
        this.toVariantSummaryDto(variant),
      ),

      variantCombinations:
        product.variants.length > 0
          ? computeVariantCombinations(product.variants)
          : undefined,

      vendor: {
        id: product.vendor.id,
        storeName: product.vendor.storeName,
        storeSlug: product.vendor.storeSlug,
        storeLogoUrl: product.vendor.storeLogoUrl,
      },

      ...resolveCategoryHierarchy(product.category, categoryMap),

      images: product.images.map((image) => ({
        id: image.id,
        url: image.url,
        publicId: image.url,
        position: image.position,
        isCover: image.position === 0,
      })),

      isActive: product.isActive,

      isDeleted: product.isDeleted,

      deletedAt: product.deletedAt ?? null,

      createdAt: product.createdAt,

      updatedAt: product.updatedAt,
    };
  }

  /**
   * Maps a Prisma variant to VariantSummaryDto.
   *
   * Timestamps come directly from Prisma.
   *
   * There is intentionally NO:
   *
   * createdAt: variant.createdAt ?? new Date()
   *
   * because manufacturing timestamps makes the API lie about the database.
   */
  private toVariantSummaryDto(variant: {
    id: string;
    options: Prisma.JsonValue;
    stock: number;
    images: string[];
    isActive: boolean;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): VariantSummaryDto {
    const options = normalizeOptions(variant.options).map(
      ({ name, value }) => ({
        name,
        value,
      }),
    );

    const { inStock, stockStatus } = getStockStatus(
      variant.stock,
      variant.isActive && !variant.isDeleted,
    );

    return {
      id: variant.id,
      options,

      stock: variant.stock,
      inStock,
      stockStatus,

      images: variant.images ?? [],

      isActive: variant.isActive,

      isDeleted: variant.isDeleted,

      createdAt: variant.createdAt,

      updatedAt: variant.updatedAt,
    };
  }

  /* ==========================================================================
   * SLUGS
   * ======================================================================== */

  /**
   * Resolves a normalized unique product slug.
   */
  private async resolveProductSlug(
    name: string,
    categoryId: string,
    explicitSlug?: string,
    excludeProductId?: string,
  ): Promise<string> {
    const base = explicitSlug?.trim()
      ? generateSlug(explicitSlug)
      : generateSlug(name);

    if (!base) {
      throw new BadRequestException(
        'Could not generate a slug; provide a slug or a name with letters or numbers',
      );
    }

    return this.ensureUniqueProductSlug(base, categoryId, excludeProductId);
  }

  /**
   * Finds the first available slug.
   *
   * This reduces the number of DB calls to one.
   *
   * HOWEVER:
   *
   * This is not a substitute for a database UNIQUE constraint.
   *
   * You should have:
   *
   * @@unique([categoryId, slug])
   *
   * in Prisma if slugs are category-scoped.
   */
  private async ensureUniqueProductSlug(
    base: string,
    categoryId: string,
    excludeProductId?: string,
  ): Promise<string> {
    const existing = await this.prisma.product.findMany({
      where: {
        categoryId,

        OR: [
          {
            slug: base,
          },
          {
            slug: {
              startsWith: `${base}-`,
            },
          },
        ],

        ...(excludeProductId
          ? {
              id: {
                not: excludeProductId,
              },
            }
          : {}),
      },

      select: {
        slug: true,
      },
    });

    const taken = new Set(existing.map((product) => product.slug));

    if (!taken.has(base)) {
      return base;
    }

    for (let suffix = 2; ; suffix++) {
      const candidate = `${base}-${suffix}`;

      if (!taken.has(candidate)) {
        return candidate;
      }
    }
  }

  /* ==========================================================================
   * CATEGORY
   * ======================================================================== */

  /**
   * Validates that a product is being assigned to a valid active leaf
   * subcategory.
   */
  private async resolveCategoryId(
    categoryId: string | undefined,
  ): Promise<string> {
    if (!categoryId) {
      throw new BadRequestException(
        'categoryId is required for product creation',
      );
    }

    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
      },

      select: {
        id: true,
        status: true,
        isActive: true,

        _count: {
          select: {
            children: true,
          },
        },
      },
    });

    if (!category) {
      throw new BadRequestException('Category not found');
    }

    if (category.status === 'ARCHIVED') {
      throw new BadRequestException(
        'Selected category is archived and cannot be assigned to new products.',
      );
    }

    if (!category.isActive || category.status === 'INACTIVE') {
      throw new BadRequestException(
        'Cannot assign a product to an inactive category',
      );
    }

    if (category._count.children > 0) {
      throw new BadRequestException(
        'Products can only be assigned to a leaf category node',
      );
    }

    return category.id;
  }

  /**
   * Returns the selected category and all descendants.
   *
   * Useful when the storefront allows browsing from a parent category.
   *
   * Requires an index on categories.parentId for good performance.
   */
  private async collectCategoryAndDescendantIds(
    categoryId: string,
  ): Promise<string[]> {
    if (!categoryId) return [];

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        categoryId,
      );
    let resolvedId = categoryId;
    if (!isUuid) {
      const found = await this.prisma.category.findFirst({
        where: {
          OR: [{ slug: categoryId }, { path: categoryId }],
        },
        select: { id: true },
      });
      if (!found) return [categoryId];
      resolvedId = found.id;
    }

    // High-performance O(1) in-memory resolution from cached category map
    try {
      const categoryMap = await this.getCategoryLookupMap();
      if (categoryMap.has(resolvedId)) {
        const descendants: string[] = [resolvedId];
        const queue: string[] = [resolvedId];
        while (queue.length > 0) {
          const currentId = queue.shift()!;
          for (const cat of categoryMap.values()) {
            if (cat.parentId === currentId && !descendants.includes(cat.id)) {
              descendants.push(cat.id);
              queue.push(cat.id);
            }
          }
        }
        return descendants;
      }
    } catch {
      // Fallback to recursive CTE below
    }

    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        WITH RECURSIVE category_descendants AS (
          SELECT id
          FROM "categories"
          WHERE id = ${resolvedId}

          UNION ALL

          SELECT category.id
          FROM "categories" category
          INNER JOIN category_descendants parent
            ON category."parentId" = parent.id
        )
        SELECT id
        FROM category_descendants
      `;
      if (rows && rows.length > 0) {
        return rows.map((r) => r.id);
      }
    } catch {
      // Fallback below
    }

    const current = await this.prisma.category.findUnique({
      where: { id: resolvedId },
      select: { id: true, path: true },
    });
    if (!current) {
      return [resolvedId];
    }

    const descendants = await this.prisma.category.findMany({
      where: {
        OR: [
          { id: resolvedId },
          { parentId: resolvedId },
          ...(current.path
            ? [{ path: { startsWith: `${current.path}/` } }]
            : []),
        ],
      },
      select: { id: true },
    });
    return descendants.map((d) => d.id);
  }

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
        await this.collectCategoryAndDescendantIds(targetCatId);

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
  private async buildListWhere(
    query: QueryProductDto,
    scope: {
      vendorId?: string;
      defaultDeleted?: boolean;
    },
  ): Promise<Prisma.ProductWhereInput> {
    const {
      search,
      categoryPath,
      categoryId: categoryIdQuery,
      inStock,
      minPrice,
      maxPrice,
      isDeleted,
      isActive,
      vendorId: queryVendorId,
    } = query;

    const where: Prisma.ProductWhereInput = {};

    /* Vendor ownership */
    if (scope.vendorId) {
      where.vendorId = scope.vendorId;
    } else if (queryVendorId) {
      where.vendorId = queryVendorId;
    }

    /* Deleted status */
    if (isDeleted !== undefined) {
      where.isDeleted = isDeleted;
    } else if (scope.defaultDeleted !== undefined) {
      where.isDeleted = scope.defaultDeleted;
    }

    /* Active status (robust boolean parsing) */
    let resolvedIsActive: boolean | undefined = undefined;
    if (typeof isActive === 'boolean') {
      resolvedIsActive = isActive;
    } else if (typeof isActive === 'string') {
      const lower = String(isActive).trim().toLowerCase();
      if (lower === 'true' || lower === '1') resolvedIsActive = true;
      if (lower === 'false' || lower === '0') resolvedIsActive = false;
    }
    if (resolvedIsActive !== undefined) {
      where.isActive = resolvedIsActive;
    }

    /* Search */
    const normalizedSearch = this.normalizeSearch(search);

    if (normalizedSearch) {
      where.OR = [
        {
          name: {
            contains: normalizedSearch,
            mode: 'insensitive',
          },
        },
        {
          sku: {
            contains: normalizedSearch,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: normalizedSearch,
            mode: 'insensitive',
          },
        },
        {
          slug: {
            contains: normalizedSearch,
            mode: 'insensitive',
          },
        },
        {
          vendor: {
            OR: [
              {
                storeName: { contains: normalizedSearch, mode: 'insensitive' },
              },
              { email: { contains: normalizedSearch, mode: 'insensitive' } },
            ],
          },
        },
        {
          category: {
            name: { contains: normalizedSearch, mode: 'insensitive' },
          },
        },
      ];
    }

    /* Category */
    let targetCatId = categoryIdQuery;
    if (!targetCatId && categoryPath) {
      targetCatId = await resolveCategoryIdFromPath(this.prisma, categoryPath);
    }

    if (targetCatId) {
      const categoryIds =
        await this.collectCategoryAndDescendantIds(targetCatId);

      where.categoryId = {
        in: categoryIds,
      };
    }

    /* Stock */
    if (inStock !== undefined) {
      if (inStock) {
        const stockOr = [
          { stock: { gt: 0 } },
          {
            hasVariants: true,
            variants: {
              some: {
                stock: { gt: 0 },
                isActive: true,
              },
            },
          },
        ];
        if (where.OR) {
          where.AND = [
            ...(Array.isArray(where.AND)
              ? where.AND
              : where.AND
                ? [where.AND]
                : []),
            { OR: stockOr },
          ];
        } else {
          where.OR = stockOr;
        }
      } else {
        where.stock = { lte: 0 };
        where.variants = {
          none: {
            stock: { gt: 0 },
            isActive: true,
          },
        };
      }
    }

    /* Price */
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};

      if (minPrice !== undefined) {
        where.price.gte = minPrice;
      }

      if (maxPrice !== undefined) {
        where.price.lte = maxPrice;
      }
    }

    return where;
  }

  /* ==========================================================================
   * CACHE
   * ======================================================================== */

  /**
   * Generates the page-pagination cache key.
   *
   * Every filter that affects the result MUST be represented in the key.
   */
  private resolveProductOrderBy(
    sort?: string,
  ): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case 'price_asc':
        return [{ price: 'asc' }, { id: 'desc' }];
      case 'price_desc':
        return [{ price: 'desc' }, { id: 'desc' }];
      case 'oldest':
        return [{ createdAt: 'asc' }, { id: 'asc' }];
      case 'newest':
      default:
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  }

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

  /**
   * Centralized product cache invalidation.
   *
   * Exact keys handle product detail pages.
   * Pattern keys handle product listing caches.
   */
  private async invalidateProductCaches(params: {
    slugs?: string[];
    id?: string;
    vendorStoreSlug?: string;
  }): Promise<void> {
    const exactKeys = (params.slugs ?? [])
      .filter(Boolean)
      .flatMap((slug) => [PRODUCT_BY_SLUG(slug), `product:slug:${slug}`]);

    if (params.id) {
      exactKeys.push(`product:id:${params.id}`);
    }

    this.categoryLookupCache = null;

    const operations = [
      ...exactKeys.map((key) => this.cacheService.del(key)),

      /*
       * Both page and cursor public listing caches are invalidated here.
       */
      this.cacheService.delByPattern('product:list:public:*'),

      /*
       * Trending showcase cache.
       */
      this.cacheService.delByPattern('products:trending:*'),

      /*
       * Legacy cache namespace retained for compatibility.
       */
      this.cacheService.delByPattern('products:public:*'),

      /*
       * Invalidate category trees and listings so product counts remain accurate.
       */
      this.cacheService.delByPattern('category:*'),
      this.cacheService.delByPattern('categories:*'),
    ];

    if (params.vendorStoreSlug) {
      operations.push(
        this.cacheService.delByPattern(
          VENDOR_STORE_PRODUCTS(params.vendorStoreSlug),
        ),
      );
    }

    /*
     * All invalidations are independent, so execute them concurrently.
     */
    await Promise.all(operations);
  }
}

import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_INDEXES,
  MARKETPLACE_INDEXES,
  MAX_LIMIT,
  MIN_SEARCH_LENGTH,
  SIMILARITY_THRESHOLD,
} from '../constants/search.constants';
import type {
  CategoryRow,
  DiscountCodeRow,
  OrderRow,
  ProductRow,
  ProductSearchIdRow,
  SearchIndex,
  SearchProductsResponsePayload,
  SearchResponsePayload,
  SearchResultItem,
  UserRow,
  VendorRow,
} from '../types/search.types';
import {
  buildCacheKey,
  filterIndexes,
  normalizeLimit,
  normalizePage,
  normalizeSearch,
} from '../utils/search-input.util';
import { SearchCacheService } from './search-cache.service';

/**
 * Search for shoppers and for administrators: products (with full details), the marketplace
 * (products, stores and categories), autocomplete, and the admin-wide search that also covers users,
 * orders and discount codes. Vendor search is `VendorSearchService`; status and cache maintenance are
 * `SearchOperationsService`.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: SearchCacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // PUBLIC PRODUCT SEARCH
  // ---------------------------------------------------------------------------

  async searchProducts(
    search: string,
    categoryId?: string,
    page = 1,
    limit = 10,
  ): Promise<{
    ids: string[];
    total: number;
  } | null> {
    const normalizedSearch = normalizeSearch(search);

    if (normalizedSearch.length < MIN_SEARCH_LENGTH) {
      return null;
    }

    const safePage = normalizePage(page);
    const safeLimit = normalizeLimit(limit);

    const cacheKey = buildCacheKey(
      'products:ids',
      normalizedSearch,
      categoryId ?? 'all',
      safePage,
      safeLimit,
    );

    const cached = await this.cache.get<{
      ids: string[];
      total: number;
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    const ilikeSearch = `%${normalizedSearch}%`;
    const prefixSearch = `${normalizedSearch}%`;
    const offset = (safePage - 1) * safeLimit;

    const products = categoryId
      ? await this.prisma.$queryRaw<ProductSearchIdRow[]>`
            SELECT
              p.id,
              (
                CASE
                  WHEN LOWER(p.name) = LOWER(${normalizedSearch})
                    THEN 10.0 + similarity(p.name, ${normalizedSearch})
                  WHEN p.name ILIKE ${prefixSearch}
                    THEN 6.0 + similarity(p.name, ${normalizedSearch})
                  WHEN LOWER(p.sku) = LOWER(${normalizedSearch})
                    THEN 5.0
                  WHEN p.sku ILIKE ${prefixSearch}
                    THEN 4.0
                  WHEN p.name ILIKE ${ilikeSearch}
                    THEN 3.0 + similarity(p.name, ${normalizedSearch})
                  WHEN to_tsvector('simple', p.name) @@ plainto_tsquery('simple', ${normalizedSearch})
                    THEN 2.8 + similarity(p.name, ${normalizedSearch})
                  WHEN p.sku ILIKE ${ilikeSearch}
                    THEN 2.5 + similarity(p.sku, ${normalizedSearch})
                  WHEN v."storeName" ILIKE ${ilikeSearch}
                    THEN 2.0 + similarity(COALESCE(v."storeName", ''), ${normalizedSearch})
                  WHEN to_tsvector('simple', p.name || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(v."storeName", '')) @@ plainto_tsquery('simple', ${normalizedSearch})
                    THEN 1.5 + similarity(p.name, ${normalizedSearch})
                  WHEN COALESCE(p.description, '') ILIKE ${ilikeSearch}
                    THEN 1.2 + similarity(COALESCE(p.description, ''), ${normalizedSearch})
                  ELSE similarity(p.name, ${normalizedSearch})
                END
              ) AS score,
              COUNT(*) OVER()::integer AS total_count
            FROM products p
            LEFT JOIN vendors v ON v.id = p."vendorId"
            WHERE
              p."isActive" = true
              AND p."isDeleted" = false
              AND p."categoryId" = ${categoryId}
              AND (
                p.name ILIKE ${ilikeSearch}
                OR p.sku ILIKE ${ilikeSearch}
                OR COALESCE(p.description, '') ILIKE ${ilikeSearch}
                OR v."storeName" ILIKE ${ilikeSearch}
                OR to_tsvector('simple', p.name || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(v."storeName", '')) @@ plainto_tsquery('simple', ${normalizedSearch})
                OR similarity(p.name, ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
                OR similarity(p.sku, ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
                OR similarity(COALESCE(p.description, ''), ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
                OR similarity(COALESCE(v."storeName", ''), ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
              )
            ORDER BY score DESC, p."createdAt" DESC
            LIMIT ${safeLimit}
            OFFSET ${offset};
          `
      : await this.prisma.$queryRaw<ProductSearchIdRow[]>`
            SELECT
              p.id,
              (
                CASE
                  WHEN LOWER(p.name) = LOWER(${normalizedSearch})
                    THEN 10.0 + similarity(p.name, ${normalizedSearch})
                  WHEN p.name ILIKE ${prefixSearch}
                    THEN 6.0 + similarity(p.name, ${normalizedSearch})
                  WHEN LOWER(p.sku) = LOWER(${normalizedSearch})
                    THEN 5.0
                  WHEN p.sku ILIKE ${prefixSearch}
                    THEN 4.0
                  WHEN p.name ILIKE ${ilikeSearch}
                    THEN 3.0 + similarity(p.name, ${normalizedSearch})
                  WHEN to_tsvector('simple', p.name) @@ plainto_tsquery('simple', ${normalizedSearch})
                    THEN 2.8 + similarity(p.name, ${normalizedSearch})
                  WHEN p.sku ILIKE ${ilikeSearch}
                    THEN 2.5 + similarity(p.sku, ${normalizedSearch})
                  WHEN v."storeName" ILIKE ${ilikeSearch}
                    THEN 2.0 + similarity(COALESCE(v."storeName", ''), ${normalizedSearch})
                  WHEN c.name ILIKE ${ilikeSearch}
                    THEN 1.8 + similarity(COALESCE(c.name, ''), ${normalizedSearch})
                  WHEN to_tsvector('simple', p.name || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(v."storeName", '') || ' ' || COALESCE(c.name, '')) @@ plainto_tsquery('simple', ${normalizedSearch})
                    THEN 1.5 + similarity(p.name, ${normalizedSearch})
                  WHEN COALESCE(p.description, '') ILIKE ${ilikeSearch}
                    THEN 1.2 + similarity(COALESCE(p.description, ''), ${normalizedSearch})
                  ELSE similarity(p.name, ${normalizedSearch})
                END
              ) AS score,
              COUNT(*) OVER()::integer AS total_count
            FROM products p
            LEFT JOIN vendors v ON v.id = p."vendorId"
            LEFT JOIN categories c ON c.id = p."categoryId"
            WHERE
              p."isActive" = true
              AND p."isDeleted" = false
              AND (
                p.name ILIKE ${ilikeSearch}
                OR p.sku ILIKE ${ilikeSearch}
                OR COALESCE(p.description, '') ILIKE ${ilikeSearch}
                OR v."storeName" ILIKE ${ilikeSearch}
                OR c.name ILIKE ${ilikeSearch}
                OR to_tsvector('simple', p.name || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(v."storeName", '') || ' ' || COALESCE(c.name, '')) @@ plainto_tsquery('simple', ${normalizedSearch})
                OR similarity(p.name, ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
                OR similarity(p.sku, ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
                OR similarity(COALESCE(p.description, ''), ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
                OR similarity(COALESCE(v."storeName", ''), ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
                OR similarity(COALESCE(c.name, ''), ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
              )
            ORDER BY score DESC, p."createdAt" DESC
            LIMIT ${safeLimit}
            OFFSET ${offset};
          `;

    const total = products.length > 0 ? Number(products[0].total_count) : 0;

    const result = {
      ids: products.map((product) => product.id),
      total,
    };

    await this.cache.set(cacheKey, result);

    return result;
  }

  // ---------------------------------------------------------------------------
  // DETAILED PRODUCT SEARCH
  // ---------------------------------------------------------------------------

  async searchProductsWithDetails(
    search: string,
    page = 1,
    limit = 10,
  ): Promise<SearchProductsResponsePayload | null> {
    const normalizedSearch = normalizeSearch(search);

    if (!normalizedSearch) {
      return null;
    }

    const safePage = normalizePage(page);
    const safeLimit = normalizeLimit(limit);

    const cacheKey = buildCacheKey(
      'products:details',
      normalizedSearch,
      safePage,
      safeLimit,
    );

    const cached =
      await this.cache.get<SearchProductsResponsePayload>(cacheKey);

    if (cached) {
      return cached;
    }

    const ilikeSearch = `%${normalizedSearch}%`;
    const prefixSearch = `${normalizedSearch}%`;
    const offset = (safePage - 1) * safeLimit;

    const matchedProducts = await this.prisma.$queryRaw<ProductSearchIdRow[]>`
        SELECT
          p.id,
          (
            CASE
              WHEN LOWER(p.name) = LOWER(${normalizedSearch})
                THEN 10.0 + similarity(p.name, ${normalizedSearch})
              WHEN p.name ILIKE ${prefixSearch}
                THEN 6.0 + similarity(p.name, ${normalizedSearch})
              WHEN LOWER(p.sku) = LOWER(${normalizedSearch})
                THEN 5.0
              WHEN p.sku ILIKE ${prefixSearch}
                THEN 4.0
              WHEN p.name ILIKE ${ilikeSearch}
                THEN 3.0 + similarity(p.name, ${normalizedSearch})
              WHEN to_tsvector('simple', p.name) @@ plainto_tsquery('simple', ${normalizedSearch})
                THEN 2.8 + similarity(p.name, ${normalizedSearch})
              WHEN p.sku ILIKE ${ilikeSearch}
                THEN 2.5 + similarity(p.sku, ${normalizedSearch})
              WHEN v."storeName" ILIKE ${ilikeSearch}
                THEN 2.0 + similarity(COALESCE(v."storeName", ''), ${normalizedSearch})
              WHEN c.name ILIKE ${ilikeSearch}
                THEN 1.8 + similarity(COALESCE(c.name, ''), ${normalizedSearch})
              WHEN to_tsvector('simple', p.name || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(v."storeName", '') || ' ' || COALESCE(c.name, '')) @@ plainto_tsquery('simple', ${normalizedSearch})
                THEN 1.5 + similarity(p.name, ${normalizedSearch})
              WHEN COALESCE(p.description, '') ILIKE ${ilikeSearch}
                THEN 1.2 + similarity(COALESCE(p.description, ''), ${normalizedSearch})
              ELSE similarity(p.name, ${normalizedSearch})
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM products p
        LEFT JOIN vendors v ON v.id = p."vendorId"
        LEFT JOIN categories c ON c.id = p."categoryId"
        WHERE
          p."isActive" = true
          AND p."isDeleted" = false
          AND (
            p.name ILIKE ${ilikeSearch}
            OR p.sku ILIKE ${ilikeSearch}
            OR COALESCE(p.description, '') ILIKE ${ilikeSearch}
            OR v."storeName" ILIKE ${ilikeSearch}
            OR c.name ILIKE ${ilikeSearch}
            OR to_tsvector('simple', p.name || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(v."storeName", '') || ' ' || COALESCE(c.name, '')) @@ plainto_tsquery('simple', ${normalizedSearch})
            OR similarity(p.name, ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
            OR similarity(p.sku, ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE(p.description, ''), ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE(v."storeName", ''), ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE(c.name, ''), ${normalizedSearch}) > ${SIMILARITY_THRESHOLD}
          )
        ORDER BY score DESC, p."createdAt" DESC
        LIMIT ${safeLimit}
        OFFSET ${offset};
      `;

    const total =
      matchedProducts.length > 0 ? Number(matchedProducts[0].total_count) : 0;

    if (matchedProducts.length === 0) {
      const response = {
        hits: [],
        pagination: {
          total: 0,
          page: safePage,
          limit: safeLimit,
          totalPages: 0,
        },
      };

      await this.cache.set(cacheKey, response);

      return response;
    }

    const ids = matchedProducts.map((product) => product.id);

    const products = await this.prisma.product.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        vendor: {
          select: {
            storeName: true,
            storeSlug: true,
            storeLogoUrl: true,
          },
        },
        images: {
          where: {
            isPrimary: true,
          },
          take: 1,
        },
      },
    });

    const productMap = new Map(
      products.map((product) => [product.id, product]),
    );

    const orderedProducts = ids
      .map((id) => productMap.get(id))
      .filter((product): product is (typeof products)[number] =>
        Boolean(product),
      );

    const hits = orderedProducts.map((product) => ({
      type: 'product',
      title: product.name,
      description: product.description ?? null,
      image: product.images[0]?.url ?? null,
      searchKeywords: [
        product.name,
        product.category.name,
        product.vendor.storeName,
      ].filter((value): value is string => Boolean(value)),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      slug: product.slug,
      price: Number(product.price),
      vendor: {
        slug: product.vendor.storeSlug,
        logo: product.vendor.storeLogoUrl ?? null,
        banner: null,
        businessName: product.vendor.storeName,
      },
      category: {
        id: product.category.id,
        slug: product.category.slug,
        name: product.category.name,
      },
      subcategory: null,
      section: null,
      hasDiscount: false,
      discountDetails: null,
      objectID: product.id,
    }));

    const response = {
      hits,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };

    await this.cache.set(cacheKey, response);

    return response;
  }

  // ---------------------------------------------------------------------------
  // MARKETPLACE
  // ---------------------------------------------------------------------------

  async searchMarketplace(
    search: string,
    types?: SearchIndex[],
    page = 1,
    limit = 10,
  ): Promise<SearchResponsePayload | null> {
    return this.executeSearch(
      filterIndexes(types, MARKETPLACE_INDEXES),
      search,
      page,
      limit,
    );
  }

  // ---------------------------------------------------------------------------
  // ADMIN
  // ---------------------------------------------------------------------------

  async searchAdminGlobal(
    search: string,
    types?: SearchIndex[],
    page = 1,
    limit = 20,
  ): Promise<SearchResponsePayload | null> {
    /*
     * Admin search actually includes all admin entities.
     *
     * The previous implementation incorrectly used marketplace indexes
     * here, so users/orders/discount codes were never searched.
     */
    return this.executeSearch(
      filterIndexes(types, ADMIN_INDEXES),
      search,
      page,
      limit,
    );
  }

  // ---------------------------------------------------------------------------
  // MARKETPLACE AUTOCOMPLETE
  // ---------------------------------------------------------------------------

  async autocomplete(
    search: string,
    types?: SearchIndex[],
    limit = 10,
  ): Promise<SearchResultItem[] | null> {
    const normalizedSearch = normalizeSearch(search);

    if (!normalizedSearch) {
      return null;
    }

    const indexes = filterIndexes(types, MARKETPLACE_INDEXES);

    const safeLimit = normalizeLimit(limit);

    const cacheKey = buildCacheKey(
      'autocomplete-v2',
      normalizedSearch,
      indexes.join(','),
      safeLimit,
    );

    const cached = await this.cache.get<SearchResultItem[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const result = await this.executeSearch(
      indexes,
      normalizedSearch,
      1,
      safeLimit,
    );

    if (!result) {
      return null;
    }

    await this.cache.set(cacheKey, result.results);

    return result.results;
  }

  // ---------------------------------------------------------------------------
  // VENDOR SEARCH
  // ---------------------------------------------------------------------------

  private async executeSearch(
    indexes: SearchIndex[],
    search: string,
    page: number,
    limit: number,
  ): Promise<SearchResponsePayload | null> {
    const normalizedSearch = normalizeSearch(search);

    if (normalizedSearch.length < MIN_SEARCH_LENGTH) {
      return null;
    }

    const safePage = normalizePage(page);

    const safeLimit = normalizeLimit(limit);

    const sortedIndexes = [...indexes].sort();

    const cacheKey = buildCacheKey(
      'global',
      normalizedSearch,
      sortedIndexes.join(','),
      safePage,
      safeLimit,
    );

    const cached = await this.cache.get<SearchResponsePayload>(cacheKey);

    if (cached) {
      return cached;
    }

    /*
     * Fetch enough records from each index to fill the requested global page.
     *
     * This is intentionally bounded by MAX_LIMIT so a request cannot cause
     * an unbounded database query.
     */
    const searchLimit = Math.min(safePage * safeLimit, MAX_LIMIT);

    const results = await Promise.all(
      sortedIndexes.map((index) =>
        this.searchIndex(index, normalizedSearch, searchLimit),
      ),
    );

    /*
     * The previous implementation concatenated each index and then sliced.
     * That makes the first index dominate the global result.
     *
     * Sorting all returned hits by relevance gives a more predictable
     * global search experience.
     */
    const allItems = results
      .flatMap((entry) => entry.items)
      .sort((a, b) => b.score - a.score);

    const total = results.reduce((sum, entry) => sum + entry.total, 0);

    const start = (safePage - 1) * safeLimit;

    const items = allItems.slice(start, start + safeLimit);

    const response = {
      results: items,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };

    await this.cache.set(cacheKey, response);

    return response;
  }

  private async searchIndex(
    index: SearchIndex,
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    switch (index) {
      case 'products':
        return this.searchProductsDb(search, limit);

      case 'vendors':
        return this.searchVendorsDb(search, limit);

      case 'categories':
        return this.searchCategoriesDb(search, limit);

      case 'users':
        return this.searchUsersDb(search, limit);

      case 'orders':
        return this.searchOrdersDb(search, limit);

      case 'discount_codes':
        return this.searchDiscountCodesDb(search, limit);
    }
  }

  private async searchProductsDb(
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;
    const prefixPattern = `${search}%`;

    const rows = await this.prisma.$queryRaw<ProductRow[]>`
        SELECT
          p.id,
          p.name,
          p.sku,
          p.slug,
          p.price,
          (
            SELECT pi.url
            FROM product_images pi
            WHERE pi."productId" = p.id
            ORDER BY pi."isPrimary" DESC, pi.position ASC
            LIMIT 1
          ) AS "imageUrl",
          (
            CASE
              WHEN LOWER(p.name) = LOWER(${search})
                THEN 10.0 + similarity(p.name, ${search})
              WHEN p.name ILIKE ${prefixPattern}
                THEN 6.0 + similarity(p.name, ${search})
              WHEN LOWER(p.sku) = LOWER(${search})
                THEN 5.0
              WHEN p.sku ILIKE ${prefixPattern}
                THEN 4.0
              WHEN p.name ILIKE ${pattern}
                THEN 3.0 + similarity(p.name, ${search})
              WHEN to_tsvector('simple', p.name) @@ plainto_tsquery('simple', ${search})
                THEN 2.8 + similarity(p.name, ${search})
              WHEN p.sku ILIKE ${pattern}
                THEN 2.5 + similarity(p.sku, ${search})
              WHEN v."storeName" ILIKE ${pattern}
                THEN 2.0 + similarity(COALESCE(v."storeName", ''), ${search})
              WHEN c.name ILIKE ${pattern}
                THEN 1.8 + similarity(COALESCE(c.name, ''), ${search})
              WHEN to_tsvector('simple', p.name || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(v."storeName", '') || ' ' || COALESCE(c.name, '')) @@ plainto_tsquery('simple', ${search})
                THEN 1.5 + similarity(p.name, ${search})
              WHEN COALESCE(p.description, '') ILIKE ${pattern}
                THEN 1.2 + similarity(COALESCE(p.description, ''), ${search})
              ELSE similarity(p.name, ${search})
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM products p
        LEFT JOIN vendors v ON v.id = p."vendorId"
        LEFT JOIN categories c ON c.id = p."categoryId"
        WHERE
          p."isActive" = true
          AND p."isDeleted" = false
          AND (
            p.name ILIKE ${pattern}
            OR p.sku ILIKE ${pattern}
            OR COALESCE(p.description, '') ILIKE ${pattern}
            OR v."storeName" ILIKE ${pattern}
            OR c.name ILIKE ${pattern}
            OR to_tsvector('simple', p.name || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(v."storeName", '') || ' ' || COALESCE(c.name, '')) @@ plainto_tsquery('simple', ${search})
            OR similarity(p.name, ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(p.sku, ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE(p.description, ''), ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE(v."storeName", ''), ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE(c.name, ''), ${search}) > ${SIMILARITY_THRESHOLD}
          )
        ORDER BY score DESC, p."createdAt" DESC
        LIMIT ${limit};
      `;

    return {
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,

      items: rows.map((product) => ({
        id: product.id,
        index: 'products',
        type: 'product',
        title: product.name,
        subtitle: product.sku,
        score: Number(product.score),
        payload: {
          id: product.id,
          name: product.name,
          sku: product.sku,
          slug: product.slug,
          price: product.price ? Number(product.price) : 0,
          imageUrl: product.imageUrl,
        },
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // VENDORS
  // ---------------------------------------------------------------------------

  private async searchVendorsDb(
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;
    const prefixPattern = `${search}%`;

    const rows = await this.prisma.$queryRaw<VendorRow[]>`
        SELECT
          id,
          "storeName",
          "storeSlug",
          "storeLogoUrl",
          "storeDescription",
          email,
          "firstName",
          "lastName",
          (
            CASE
              WHEN LOWER("storeName") = LOWER(${search})
                THEN 10.0 + similarity("storeName", ${search})
              WHEN "storeName" ILIKE ${prefixPattern}
                THEN 6.0 + similarity("storeName", ${search})
              WHEN "storeName" ILIKE ${pattern}
                THEN 3.0 + similarity("storeName", ${search})
              WHEN to_tsvector('simple', "storeName") @@ plainto_tsquery('simple', ${search})
                THEN 2.8 + similarity("storeName", ${search})
              WHEN "firstName" ILIKE ${pattern}
                OR "lastName" ILIKE ${pattern}
                THEN 2.0 + similarity(
                  COALESCE("firstName", '') || ' ' ||
                  COALESCE("lastName", ''),
                  ${search}
                )
              WHEN to_tsvector('simple', "storeName" || ' ' || COALESCE("storeDescription", '')) @@ plainto_tsquery('simple', ${search})
                THEN 1.5 + similarity(COALESCE("storeName", ''), ${search})
              WHEN "storeDescription" ILIKE ${pattern}
                THEN 1.0 + similarity(
                  COALESCE("storeDescription", ''),
                  ${search}
                )
              ELSE similarity(
                COALESCE("storeName", ''),
                ${search}
              )
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM vendors
        WHERE
          "isActive" = true
          AND "isApproved" = true
          AND (
            "storeName" ILIKE ${pattern}
            OR COALESCE("storeDescription", '') ILIKE ${pattern}
            OR email ILIKE ${pattern}
            OR "firstName" ILIKE ${pattern}
            OR "lastName" ILIKE ${pattern}
            OR to_tsvector('simple', "storeName" || ' ' || COALESCE("storeDescription", '')) @@ plainto_tsquery('simple', ${search})
            OR similarity("storeName", ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE("storeDescription", ''), ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE("firstName", ''), ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE("lastName", ''), ${search}) > ${SIMILARITY_THRESHOLD}
          )
        ORDER BY score DESC, "createdAt" DESC
        LIMIT ${limit};
      `;

    return {
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,

      items: rows.map((vendor) => ({
        id: vendor.id,
        index: 'vendors',
        type: 'vendor',
        title: vendor.storeName,
        subtitle: vendor.storeDescription ?? undefined,
        score: Number(vendor.score),
        payload: {
          id: vendor.id,
          storeName: vendor.storeName,
          storeSlug: vendor.storeSlug,
          storeLogoUrl: vendor.storeLogoUrl,
          storeDescription: vendor.storeDescription,
          email: vendor.email,
          firstName: vendor.firstName,
          lastName: vendor.lastName,
        },
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // CATEGORIES
  // ---------------------------------------------------------------------------

  private async searchCategoriesDb(
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;
    const prefixPattern = `${search}%`;

    const rows = await this.prisma.$queryRaw<CategoryRow[]>`
        SELECT
          c.id,
          c.name,
          c.description,
          c."imageUrl",
          c.slug,
          c."parentId",
          p.name AS "parentName",
          p.slug AS "parentSlug",
          c.path,
          (
            CASE
              WHEN LOWER(c.name) = LOWER(${search})
                THEN 10.0 + similarity(c.name, ${search})
              WHEN c.name ILIKE ${prefixPattern}
                THEN 6.0 + similarity(c.name, ${search})
              WHEN c.name ILIKE ${pattern}
                THEN 3.0 + similarity(c.name, ${search})
              WHEN to_tsvector('simple', c.name) @@ plainto_tsquery('simple', ${search})
                THEN 2.8 + similarity(c.name, ${search})
              WHEN to_tsvector('simple', c.name || ' ' || COALESCE(c.description, '')) @@ plainto_tsquery('simple', ${search})
                THEN 1.5 + similarity(c.name, ${search})
              WHEN c.description ILIKE ${pattern}
                THEN 1.0 + similarity(
                  COALESCE(c.description, ''),
                  ${search}
                )
              ELSE similarity(c.name, ${search})
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM categories c
        LEFT JOIN categories p ON c."parentId" = p.id
        WHERE
          c."isActive" = true
          AND (
            c.name ILIKE ${pattern}
            OR COALESCE(c.description, '') ILIKE ${pattern}
            OR c.slug ILIKE ${pattern}
            OR to_tsvector('simple', c.name || ' ' || COALESCE(c.description, '')) @@ plainto_tsquery('simple', ${search})
            OR similarity(c.name, ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE(c.description, ''), ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(c.slug, ${search}) > ${SIMILARITY_THRESHOLD}
          )
        ORDER BY score DESC, c."createdAt" DESC
        LIMIT ${limit};
      `;

    return {
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,

      items: rows.map((category) => {
        const isSubcategory = Boolean(category.parentId);
        const type = isSubcategory ? 'subcategory' : 'category';
        const subtitle =
          isSubcategory && category.parentName
            ? `in ${category.parentName}`
            : (category.description ?? undefined);

        return {
          id: category.id,
          index: 'categories',
          type,
          title: category.name,
          subtitle,
          score: Number(category.score),
          payload: {
            id: category.id,
            name: category.name,
            description: category.description,
            imageUrl: category.imageUrl,
            slug: category.slug,
            parentId: category.parentId,
            parentName: category.parentName,
            parentSlug: category.parentSlug,
            path:
              category.path ??
              (category.parentSlug
                ? `${category.parentSlug}/${category.slug}`
                : category.slug),
            isSubcategory,
          },
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // USERS
  // ---------------------------------------------------------------------------

  private async searchUsersDb(
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;
    const prefixPattern = `${search}%`;

    const rows = await this.prisma.$queryRaw<UserRow[]>`
        SELECT
          u.id,
          u.email,
          u."firstName",
          u."lastName",
          rc.code AS "referralCode",
          (
            CASE
              WHEN LOWER(u.email) = LOWER(${search})
                THEN 10.0 + similarity(u.email, ${search})
              WHEN u.email ILIKE ${prefixPattern}
                THEN 6.0 + similarity(u.email, ${search})
              WHEN LOWER(COALESCE(rc.code, '')) = LOWER(${search})
                THEN 8.0
              WHEN rc.code ILIKE ${prefixPattern}
                THEN 5.0
              WHEN u.email ILIKE ${pattern}
                THEN 3.0 + similarity(u.email, ${search})
              WHEN rc.code ILIKE ${pattern}
                THEN 2.5 + similarity(rc.code, ${search})
              WHEN u."firstName" ILIKE ${pattern}
                OR u."lastName" ILIKE ${pattern}
                THEN 2.0 + similarity(
                  COALESCE(u."firstName", '') || ' ' ||
                  COALESCE(u."lastName", ''),
                  ${search}
                )
              ELSE similarity(u.email, ${search})
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM users u
        LEFT JOIN referral_codes rc
          ON rc."userId" = u.id
        WHERE
          u.email ILIKE ${pattern}
          OR u."firstName" ILIKE ${pattern}
          OR u."lastName" ILIKE ${pattern}
          OR rc.code ILIKE ${pattern}
          OR similarity(u.email, ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(COALESCE(u."firstName", ''), ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(COALESCE(u."lastName", ''), ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(COALESCE(rc.code, ''), ${search}) > ${SIMILARITY_THRESHOLD}
        ORDER BY score DESC, u."createdAt" DESC
        LIMIT ${limit};
      `;

    return {
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,

      items: rows.map((user) => ({
        id: user.id,
        index: 'users',
        type: 'user',
        title: user.email,
        subtitle: [user.firstName, user.lastName].filter(Boolean).join(' '),
        score: Number(user.score),
        payload: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          referralCode: user.referralCode
            ? {
                code: user.referralCode,
              }
            : null,
        },
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // ORDERS
  // ---------------------------------------------------------------------------

  private async searchOrdersDb(
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;
    const prefixPattern = `${search}%`;

    const rows = await this.prisma.$queryRaw<OrderRow[]>`
        SELECT
          o.id,
          o."orderNumber",
          o.status,
          o."discountCode",
          o."referralCode",
          o."shippingAddress",
          u.email AS "userEmail",
          (
            CASE
              WHEN LOWER(o."orderNumber") = LOWER(${search})
                THEN 10.0 + similarity(o."orderNumber", ${search})
              WHEN o."orderNumber" ILIKE ${prefixPattern}
                THEN 6.0 + similarity(o."orderNumber", ${search})
              WHEN LOWER(COALESCE(u.email, '')) = LOWER(${search})
                THEN 5.0
              WHEN o."orderNumber" ILIKE ${pattern}
                THEN 3.0 + similarity(o."orderNumber", ${search})
              WHEN o."discountCode" ILIKE ${pattern}
                THEN 2.5 + similarity(o."discountCode", ${search})
              WHEN o."referralCode" ILIKE ${pattern}
                THEN 2.5 + similarity(o."referralCode", ${search})
              WHEN u.email ILIKE ${pattern}
                THEN 2.0 + similarity(u.email, ${search})
              ELSE similarity(
                COALESCE(
                  o."shippingAddress",
                  ''
                ),
                ${search}
              )
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM orders o
        LEFT JOIN users u
          ON u.id = o."userId"
        WHERE
          o."orderNumber" ILIKE ${pattern}
          OR o."discountCode" ILIKE ${pattern}
          OR o."referralCode" ILIKE ${pattern}
          OR o."shippingAddress" ILIKE ${pattern}
          OR u.email ILIKE ${pattern}
          OR similarity(o."orderNumber", ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(COALESCE(o."shippingAddress", ''), ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(u.email, ${search}) > ${SIMILARITY_THRESHOLD}
        ORDER BY score DESC, o."createdAt" DESC
        LIMIT ${limit};
      `;

    return {
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,

      items: rows.map((order) => ({
        id: order.id,
        index: 'orders',
        type: 'order',
        title: order.orderNumber,
        subtitle: [order.userEmail, order.status, order.shippingAddress]
          .filter(Boolean)
          .join(' â€¢ '),
        score: Number(order.score),
        payload: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          discountCode: order.discountCode,
          referralCode: order.referralCode,
          shippingAddress: order.shippingAddress,
          user: order.userEmail
            ? {
                email: order.userEmail,
              }
            : null,
        },
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // DISCOUNT CODES
  // ---------------------------------------------------------------------------

  private async searchDiscountCodesDb(
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;
    const prefixPattern = `${search}%`;

    const rows = await this.prisma.$queryRaw<DiscountCodeRow[]>`
        SELECT
          id,
          code,
          description,
          (
            CASE
              WHEN LOWER(code) = LOWER(${search})
                THEN 10.0 + similarity(code, ${search})
              WHEN code ILIKE ${prefixPattern}
                THEN 6.0 + similarity(code, ${search})
              WHEN code ILIKE ${pattern}
                THEN 3.0 + similarity(code, ${search})
              WHEN description ILIKE ${pattern}
                THEN 1.0 + similarity(
                  COALESCE(description, ''),
                  ${search}
                )
              ELSE similarity(
                code,
                ${search}
              )
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM discount_codes
        WHERE
          code ILIKE ${pattern}
          OR COALESCE(description, '') ILIKE ${pattern}
          OR similarity(code, ${search}) > ${SIMILARITY_THRESHOLD}
          OR similarity(
            COALESCE(description, ''),
            ${search}
          ) > ${SIMILARITY_THRESHOLD}
        ORDER BY score DESC, "createdAt" DESC
        LIMIT ${limit};
      `;

    return {
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,

      items: rows.map((discountCode) => ({
        id: discountCode.id,
        index: 'discount_codes',
        type: 'discount_code',
        title: discountCode.code,
        subtitle: discountCode.description ?? undefined,
        score: Number(discountCode.score),
        payload: {
          id: discountCode.id,
          code: discountCode.code,
          description: discountCode.description,
        },
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // VENDOR PRODUCTS
  // ---------------------------------------------------------------------------
}

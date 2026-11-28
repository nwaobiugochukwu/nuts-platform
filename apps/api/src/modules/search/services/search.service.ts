import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import {
  MARKETPLACE_INDEXES,
  MIN_SEARCH_LENGTH,
  SIMILARITY_THRESHOLD,
} from '../constants/search.constants';
import type {
  ProductSearchIdRow,
  SearchIndex,
  SearchProductsResponsePayload,
  SearchResponsePayload,
  SearchResultItem,
} from '../types/search.types';
import {
  buildCacheKey,
  filterIndexes,
  normalizeLimit,
  normalizePage,
  normalizeSearch,
} from '../utils/search-input.util';
import { CatalogIndexSearchService } from './catalog-index-search.service';
import { SearchCacheService } from './search-cache.service';
import { SearchRunnerService } from './search-runner.service';

/**
 * Search for shoppers: products (with full details), the marketplace (products, stores and
 * categories) and autocomplete. Admin search is `AdminSearchService`, vendor search is
 * `VendorSearchService`, and status and cache maintenance are `SearchOperationsService`.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: SearchCacheService,
    private readonly runner: SearchRunnerService,
    private readonly catalog: CatalogIndexSearchService,
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

  // ---------------------------------------------------------------------------
  // MARKETPLACE
  // ---------------------------------------------------------------------------

  async searchMarketplace(
    search: string,
    types?: SearchIndex[],
    page = 1,
    limit = 10,
  ): Promise<SearchResponsePayload | null> {
    return this.runner.run({
      namespace: 'global',
      indexes: filterIndexes(types, MARKETPLACE_INDEXES),
      search,
      page,
      limit,
      searchIndex: (index, term, perIndex) =>
        this.catalog.search(index, term, perIndex),
    });
  }

  // ---------------------------------------------------------------------------
  // MARKETPLACE AUTOCOMPLETE
  // ---------------------------------------------------------------------------

  async autocomplete(
    search: string,
    types?: SearchIndex[],
    limit = 10,
  ): Promise<SearchResultItem[] | null> {
    return this.runner.autocomplete({
      cacheNamespace: 'autocomplete-v2',
      runNamespace: 'global',
      indexes: filterIndexes(types, MARKETPLACE_INDEXES),
      search,
      limit,
      searchIndex: (index, term, perIndex) =>
        this.catalog.search(index, term, perIndex),
    });
  }
}

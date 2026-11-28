import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import {
  MAX_LIMIT,
  MIN_SEARCH_LENGTH,
  SIMILARITY_THRESHOLD,
  VENDOR_INDEXES,
} from '../constants/search.constants';
import type {
  DiscountCodeRow,
  OrderRow,
  ProductRow,
  SearchIndex,
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
import { SearchCacheService } from './search-cache.service';

/**
 * Search inside a vendor's own store: their products, orders and discount codes. Everything it
 * returns is scoped to the vendor it is asked about.
 */
@Injectable()
export class VendorSearchService {
  private readonly logger = new Logger(VendorSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: SearchCacheService,
  ) {}

  async searchVendorGlobal(
    vendorId: string,
    search: string,
    types?: SearchIndex[],
    page = 1,
    limit = 10,
  ): Promise<SearchResponsePayload | null> {
    return this.executeVendorSearch(
      vendorId,
      filterIndexes(types, VENDOR_INDEXES),
      search,
      page,
      limit,
    );
  }

  async autocompleteVendor(
    vendorId: string,
    search: string,
    types?: SearchIndex[],
    limit = 10,
  ): Promise<SearchResultItem[] | null> {
    const normalizedSearch = normalizeSearch(search);

    if (!normalizedSearch) {
      return null;
    }

    const indexes = filterIndexes(types, VENDOR_INDEXES);

    const safeLimit = normalizeLimit(limit);

    const cacheKey = buildCacheKey(
      `vendor:${vendorId}:autocomplete`,
      normalizedSearch,
      indexes.join(','),
      safeLimit,
    );

    const cached = await this.cache.get<SearchResultItem[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const result = await this.executeVendorSearch(
      vendorId,
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
  // GENERIC SEARCH
  // ---------------------------------------------------------------------------

  private async executeVendorSearch(
    vendorId: string,
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
      `vendor:${vendorId}`,
      normalizedSearch,
      sortedIndexes.join(','),
      safePage,
      safeLimit,
    );

    const cached = await this.cache.get<SearchResponsePayload>(cacheKey);

    if (cached) {
      return cached;
    }

    const searchLimit = Math.min(safePage * safeLimit, MAX_LIMIT);

    const results = await Promise.all(
      sortedIndexes.map((index) =>
        this.searchVendorIndex(vendorId, index, normalizedSearch, searchLimit),
      ),
    );

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

  // ---------------------------------------------------------------------------
  // INDEX DISPATCH
  // ---------------------------------------------------------------------------

  private async searchVendorIndex(
    vendorId: string,
    index: SearchIndex,
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    switch (index) {
      case 'products':
        return this.searchVendorProductsDb(vendorId, search, limit);

      case 'orders':
        return this.searchVendorOrdersDb(vendorId, search, limit);

      case 'discount_codes':
        return this.searchVendorDiscountCodesDb(vendorId, search, limit);

      default:
        return {
          items: [],
          total: 0,
        };
    }
  }

  // ---------------------------------------------------------------------------
  // PRODUCTS
  // ---------------------------------------------------------------------------

  private async searchVendorProductsDb(
    vendorId: string,
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
          id,
          name,
          sku,
          (
            CASE
              WHEN LOWER(name) = LOWER(${search})
                THEN 10.0 + similarity(name, ${search})
              WHEN name ILIKE ${prefixPattern}
                THEN 6.0 + similarity(name, ${search})
              WHEN LOWER(sku) = LOWER(${search})
                THEN 5.0
              WHEN sku ILIKE ${prefixPattern}
                THEN 4.0
              WHEN name ILIKE ${pattern}
                THEN 3.0 + similarity(name, ${search})
              WHEN to_tsvector('simple', name) @@ plainto_tsquery('simple', ${search})
                THEN 2.8 + similarity(name, ${search})
              WHEN sku ILIKE ${pattern}
                THEN 2.5 + similarity(sku, ${search})
              WHEN to_tsvector('simple', name || ' ' || COALESCE(description, '')) @@ plainto_tsquery('simple', ${search})
                THEN 1.5 + similarity(name, ${search})
              WHEN COALESCE(description, '') ILIKE ${pattern}
                THEN 1.2 + similarity(COALESCE(description, ''), ${search})
              ELSE similarity(name, ${search})
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM products
        WHERE
          "vendorId" = ${vendorId}
          AND "isDeleted" = false
          AND (
            name ILIKE ${pattern}
            OR sku ILIKE ${pattern}
            OR COALESCE(description, '') ILIKE ${pattern}
            OR to_tsvector('simple', name || ' ' || COALESCE(description, '')) @@ plainto_tsquery('simple', ${search})
            OR similarity(name, ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(sku, ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(COALESCE(description, ''), ${search}) > ${SIMILARITY_THRESHOLD}
          )
        ORDER BY score DESC, "createdAt" DESC
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
        },
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // VENDOR ORDERS
  // ---------------------------------------------------------------------------

  private async searchVendorOrdersDb(
    vendorId: string,
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;
    const prefixPattern = `${search}%`;

    const rows = await this.prisma.$queryRaw<OrderRow[]>`
        WITH unique_orders AS (
          SELECT DISTINCT
            o.id,
            o."orderNumber",
            o.status,
            o."discountCode",
            o."referralCode",
            o."shippingAddress",
            u.email AS "userEmail",
            o."createdAt"
          FROM orders o
          LEFT JOIN users u
            ON u.id = o."userId"
          INNER JOIN order_items oi
            ON oi."orderId" = o.id
          WHERE
            oi."vendorId" = ${vendorId}
            AND (
              o."orderNumber" ILIKE ${pattern}
              OR o."discountCode" ILIKE ${pattern}
              OR o."referralCode" ILIKE ${pattern}
              OR o."shippingAddress" ILIKE ${pattern}
              OR u.email ILIKE ${pattern}
              OR similarity(o."orderNumber", ${search}) > ${SIMILARITY_THRESHOLD}
              OR similarity(COALESCE(o."shippingAddress", ''), ${search}) > ${SIMILARITY_THRESHOLD}
              OR similarity(u.email, ${search}) > ${SIMILARITY_THRESHOLD}
            )
        )
        SELECT
          id,
          "orderNumber",
          status,
          "discountCode",
          "referralCode",
          "shippingAddress",
          "userEmail",
          (
            CASE
              WHEN LOWER("orderNumber") = LOWER(${search})
                THEN 10.0 + similarity("orderNumber", ${search})
              WHEN "orderNumber" ILIKE ${prefixPattern}
                THEN 6.0 + similarity("orderNumber", ${search})
              WHEN LOWER(COALESCE("userEmail", '')) = LOWER(${search})
                THEN 5.0
              WHEN "orderNumber" ILIKE ${pattern}
                THEN 3.0 + similarity("orderNumber", ${search})
              WHEN "userEmail" ILIKE ${pattern}
                THEN 2.0 + similarity("userEmail", ${search})
              ELSE similarity(
                COALESCE(
                  "shippingAddress",
                  ''
                ),
                ${search}
              )
            END
          ) AS score,
          COUNT(*) OVER()::integer AS total_count
        FROM unique_orders
        ORDER BY score DESC, "createdAt" DESC
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
  // VENDOR DISCOUNT CODES
  // ---------------------------------------------------------------------------

  private async searchVendorDiscountCodesDb(
    vendorId: string,
    search: string,
    limit: number,
  ): Promise<{
    items: SearchResultItem[];
    total: number;
  }> {
    const pattern = `%${search}%`;

    const rows = await this.prisma.$queryRaw<DiscountCodeRow[]>`
        SELECT
          id,
          code,
          description,
          (
            CASE
              WHEN code ILIKE ${pattern}
                THEN 2.0 + similarity(
                  code,
                  ${search}
                )
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
          "vendorId" = ${vendorId}
          AND (
            code ILIKE ${pattern}
            OR COALESCE(description, '') ILIKE ${pattern}
            OR similarity(code, ${search}) > ${SIMILARITY_THRESHOLD}
            OR similarity(
              COALESCE(description, ''),
              ${search}
            ) > ${SIMILARITY_THRESHOLD}
          )
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
  // HELPERS
  // ---------------------------------------------------------------------------
}

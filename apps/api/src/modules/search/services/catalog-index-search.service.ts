import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { Injectable } from '@nestjs/common';
import type {
  CategoryRow,
  ProductRow,
  SearchIndex,
  SearchResultItem,
  VendorRow,
} from '../types/search.types';
import { SIMILARITY_THRESHOLD } from '../constants/search.constants';
import type { IndexHits } from './search-runner.service';

/**
 * Searches the three indexes everyone can see: products, stores and categories. Used by the
 * storefront search and, with the admin-only indexes added, by the admin search.
 */
@Injectable()
export class CatalogIndexSearchService {
  constructor(private readonly prisma: PrismaService) {}

  /** Searches one catalogue index; any other index has nothing here. */
  search(index: SearchIndex, term: string, limit: number): Promise<IndexHits> {
    switch (index) {
      case 'products':
        return this.products(term, limit);
      case 'vendors':
        return this.vendors(term, limit);
      case 'categories':
        return this.categories(term, limit);
      default:
        return Promise.resolve({ items: [], total: 0 });
    }
  }

  async products(
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

  async vendors(
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

  async categories(
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
}

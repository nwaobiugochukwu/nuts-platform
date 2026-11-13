import { serverFetch, serverFetchEnvelope } from "@/api/core/server-fetcher";
import type { ProductCardDto, PublicProductResponseDto } from "@/api/dto/product";
import type { ProductReviewsMetaDto, ReviewResponseDto } from "@/api/dto/review";
import type { CursorPaginationMeta, PaginationMeta } from "@/api/core/types";
import { cache } from "react";

/**
 * Server-side public products listing with filters and cursor/pagination.
 * Cached with 60s revalidation.
 */
function parseProductPaginationMeta(value: unknown): PaginationMeta | CursorPaginationMeta | null {
  if (!value || typeof value !== "object") return null;
  const meta = value as Record<string, unknown>;
  if (
    typeof meta.page === "number" &&
    typeof meta.limit === "number" &&
    typeof meta.totalPages === "number"
  ) {
    return {
      page: meta.page,
      limit: meta.limit,
      totalPages: meta.totalPages,
      ...(typeof meta.totalItems === "number" ? { totalItems: meta.totalItems } : {}),
      ...(typeof meta.total === "number" ? { total: meta.total } : {}),
      ...(typeof meta.hasNextPage === "boolean" ? { hasNextPage: meta.hasNextPage } : {}),
      ...(typeof meta.hasPreviousPage === "boolean" ? { hasPreviousPage: meta.hasPreviousPage } : {}),
    };
  }
  if (
    typeof meta.limit === "number" &&
    typeof meta.hasNextPage === "boolean" &&
    (typeof meta.nextCursor === "string" || meta.nextCursor === null)
  ) {
    return {
      limit: meta.limit,
      hasNextPage: meta.hasNextPage,
      nextCursor: meta.nextCursor,
      ...(typeof meta.totalItems === "number" ? { totalItems: meta.totalItems } : {}),
    };
  }
  return null;
}

export const serverGetProducts = cache(async function serverGetProducts(params: {
  limit?: number;
  cursor?: string;
  page?: number;
  categoryId?: string;
  category?: string;
  sort?: string;
  search?: string;
  minPrice?: number | string;
  maxPrice?: number | string;
  inStock?: boolean | string;
} = {}): Promise<{ data: ProductCardDto[]; meta: PaginationMeta | CursorPaginationMeta | null }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.page) query.set("page", String(params.page));
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.category) query.set("category", params.category);
  if (params.sort) query.set("sort", params.sort);
  if (params.search) query.set("search", params.search);
  if (params.minPrice) query.set("minPrice", String(params.minPrice));
  if (params.maxPrice) query.set("maxPrice", String(params.maxPrice));
  if (params.inStock !== undefined && params.inStock !== false && params.inStock !== "false") {
    query.set("inStock", "true");
  }

  const qs = query.toString();
  const endpoint = `/products${qs ? `?${qs}` : ""}`;
  const res = await serverFetchEnvelope<ProductCardDto[]>(endpoint, {
    revalidate: 60,
    tags: ["products", ...(params.categoryId ? [`category:${params.categoryId}`] : [])],
  });

  return {
    data: Array.isArray(res?.data) ? res.data : [],
    meta: parseProductPaginationMeta(res?.meta),
  };
});

export interface ServerCategoryProductPreview {
  items: ProductCardDto[];
  totalItems: number;
  totalPages: number;
}

export const serverGetCategoryPreviews = cache(async function serverGetCategoryPreviews(
  parentCategoryId: string,
  limit = 12,
): Promise<Record<string, ServerCategoryProductPreview>> {
  if (!parentCategoryId) return {};
  const query = new URLSearchParams({ parentCategoryId, limit: String(limit) });
  const response = await serverFetchEnvelope<Record<string, ServerCategoryProductPreview>>(
    `/products/category-previews?${query.toString()}`,
    {
      revalidate: 60,
      tags: ["products", `category:${parentCategoryId}`],
    },
  );
  return response?.data && typeof response.data === "object" ? response.data : {};
});

export const serverGetTrendingProducts = cache(async function serverGetTrendingProducts(params: {
  categoryId?: string;
  limit?: number;
  days?: number;
} = {}): Promise<ProductCardDto[]> {
  const query = new URLSearchParams();
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.days) query.set("days", String(params.days));
  const searchParams = query.toString();
  const response = await serverFetch<ProductCardDto[]>(
    `/products/trending${searchParams ? `?${searchParams}` : ""}`,
    { revalidate: 60, tags: ["products", "trending", ...(params.categoryId ? [`category:${params.categoryId}`] : [])] },
  );
  return Array.isArray(response) ? response : [];
});

/** Cursor-based product feed used by the Discover page. */
export const serverGetProductDiscovery = cache(async function serverGetProductDiscovery(params: {
  limit?: number;
  cursor?: string;
  categoryId?: string;
  categoryPath?: string;
  vendorId?: string;
  sort?: string;
  search?: string;
  minPrice?: number | string;
  maxPrice?: number | string;
  inStock?: boolean | string;
} = {}): Promise<{
  data: ProductCardDto[];
  meta: CursorPaginationMeta | null;
  failed: boolean;
}> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.categoryId) query.set("categoryId", params.categoryId);
  if (params.categoryPath) query.set("categoryPath", params.categoryPath);
  if (params.vendorId) query.set("vendorId", params.vendorId);
  if (params.sort) query.set("sort", params.sort);
  if (params.search) query.set("search", params.search);
  if (params.minPrice !== undefined && params.minPrice !== "") query.set("minPrice", String(params.minPrice));
  if (params.maxPrice !== undefined && params.maxPrice !== "") query.set("maxPrice", String(params.maxPrice));
  if (params.inStock !== undefined) query.set("inStock", String(params.inStock));

  const searchParams = query.toString();
  const endpoint = `/discover${searchParams ? `?${searchParams}` : ""}`;
  const response = await serverFetchEnvelope<ProductCardDto[]>(endpoint, {
    revalidate: 60,
    includeHttpErrorStatus: true,
    tags: ["products", "discover", ...(params.categoryId ? [`category:${params.categoryId}`] : [])],
  });

  return {
    data: Array.isArray(response?.data) ? response.data : [],
    meta: response ? parseProductPaginationMeta(response.meta) as CursorPaginationMeta | null : null,
    failed: !response || response.statusCode !== undefined || !Array.isArray(response.data),
  };
});

/**
 * Server-side single product fetch by slug for Product Detail Pages.
 * Cached with 120s revalidation per product slug.
 */
export const serverGetProductBySlug = cache(async function serverGetProductBySlug(
  slug: string
): Promise<PublicProductResponseDto | null> {
  if (!slug) return null;
  return serverFetch<PublicProductResponseDto>(`/products/${encodeURIComponent(slug)}`, {
    revalidate: 120,
    tags: ["products", `product:${slug}`],
  });
});

/**
 * Server-side product reviews fetch for RSC product detail pages.
 * Cached with 60s revalidation per product ID.
 */
export const serverGetProductReviews = cache(async function serverGetProductReviews(
  productId: string
): Promise<{ data: ReviewResponseDto[]; meta: ProductReviewsMetaDto }> {
  if (!productId) {
    return {
      data: [],
      meta: { total: 0, averageRating: 0, ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
    };
  }
  const res = await serverFetchEnvelope<ReviewResponseDto[]>(`/reviews/product/${encodeURIComponent(productId)}`, {
    revalidate: 60,
    tags: ["reviews", `product-reviews:${productId}`],
  });

  return {
    data: Array.isArray(res?.data) ? res.data : [],
    meta: (res?.meta as ProductReviewsMetaDto | undefined) ?? { total: 0, averageRating: 0, ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
  };
});

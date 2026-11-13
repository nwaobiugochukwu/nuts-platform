import { serverFetch } from "@/api/core/server-fetcher";
import type { PublicProductResponseDto } from "@/api/dto/product";
import type { FeaturedVendorDto, VendorResponseDto, VendorStoreDto } from "@/api/dto/vendor";

/**
 * Server-side vendor directory fetch.
 */
export async function serverGetVendors(params: {
  categoryId?: string;
  search?: string;
  limit?: number;
} = {}): Promise<VendorResponseDto[]> {
  const query = new URLSearchParams();
  if (params.categoryId && params.categoryId !== "ALL") query.set("categoryId", params.categoryId);
  if (params.search) query.set("search", params.search);
  if (params.limit) query.set("limit", String(params.limit));

  const qs = query.toString();
  const endpoint = `/vendors/store${qs ? `?${qs}` : ""}`;
  const data = await serverFetch<VendorResponseDto[]>(endpoint, {
    revalidate: 300,
    tags: ["vendors"],
  });
  return Array.isArray(data) ? data : [];
}

export async function serverGetFeaturedVendors(limit = 8): Promise<FeaturedVendorDto[]> {
  const data = await serverFetch<FeaturedVendorDto[]>(
    `/vendors/store/featured?limit=${Math.min(12, Math.max(1, limit))}`,
    { revalidate: 120, tags: ["vendors", "featured-vendors"] },
  );
  return Array.isArray(data) ? data : [];
}

/**
 * Server-side single vendor store profile and store products.
 */
export async function serverGetVendorStore(
  slug: string
): Promise<{ store: VendorStoreDto | null; products: PublicProductResponseDto[] }> {
  if (!slug) return { store: null, products: [] };
  const [store, productResult] = await Promise.all([
    serverFetch<VendorStoreDto>(`/vendors/store/${encodeURIComponent(slug)}`, {
      revalidate: 120,
      tags: ["vendors", `vendor:${slug}`],
    }),
    serverFetch<PublicProductResponseDto[] | { products: PublicProductResponseDto[] }>(`/vendors/store/${encodeURIComponent(slug)}/products`, {
      revalidate: 60,
      tags: ["products", `vendor:${slug}:products`],
    }),
  ]);
  const products = Array.isArray(productResult)
    ? productResult
    : Array.isArray(productResult?.products)
      ? productResult.products
      : [];
  return {
    store: store ?? null,
    products: Array.isArray(products) ? products : [],
  };
}

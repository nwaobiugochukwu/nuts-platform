import { serverGetCategories, serverGetProductDiscovery, serverGetVendors } from "@/api/server";
import { ProductCatalogView } from "@/components/domain/product/ProductCatalogView";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Good Finds Across the Market",
  description: "Find your next favourite from vendors across NUTS.",
};

const SORT_OPTIONS = new Set(["newest", "oldest", "price_asc", "price_desc"]);

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{
    categoryId?: string;
    vendorId?: string;
    sort?: string;
    minPrice?: string;
    maxPrice?: string;
    inStock?: string;
    search?: string;
  }>;
}) {
  const params = await searchParams;
  const sort = params.sort && SORT_OPTIONS.has(params.sort) ? params.sort : "newest";
  const categoryId = params.categoryId?.trim() || "";
  const vendorId = params.vendorId?.trim() || "";
  const parsePrice = (value?: string) => {
    if (!value?.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const minPrice = parsePrice(params.minPrice);
  const maxPrice = parsePrice(params.maxPrice);
  const inStock = params.inStock === "true";
  const search = params.search?.trim() || "";

  const [categories, products, vendors] = await Promise.all([
    serverGetCategories(),
    serverGetProductDiscovery({
      limit: 24,
      sort,
      categoryId: categoryId || undefined,
      vendorId: vendorId || undefined,
      minPrice,
      maxPrice,
      inStock: inStock || undefined,
      search: search || undefined,
    }),
    serverGetVendors({ limit: 100 }),
  ]);

  return (
    <ProductCatalogView
      initialCategories={categories}
      initialProducts={products.data}
      initialMeta={products.meta ?? undefined}
      initialLoadFailed={products.failed}
      vendorOptions={vendors.map(({ id, storeName }) => ({ id, storeName }))}
      showPersonalizedShelf
      initialFilters={{
        categoryId,
        vendorId,
        sort,
        minPrice: minPrice === undefined ? "" : String(minPrice),
        maxPrice: maxPrice === undefined ? "" : String(maxPrice),
        inStock,
        search,
      }}
    />
  );
}

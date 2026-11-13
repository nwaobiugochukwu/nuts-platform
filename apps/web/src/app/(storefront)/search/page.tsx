import { serverGetCategories, serverGetProducts, serverGetVendors } from "@/api/server";
import { ProductCatalogView } from "@/component/product/ProductCatalogView";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { Search, Sparkles } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Search | NUTS-P Marketplace",
  description: "Search products from independent vendors across Nigeria.",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; query?: string }>;
}) {
  const [params, categories] = await Promise.all([searchParams, serverGetCategories()]);
  const rawQuery = params.query || params.q || "";
  const search = rawQuery.trim().slice(0, 100);

  if (!search) {
    return (
      <CustomerLayout categories={categories}>
        <main className="mx-auto flex min-h-[60svh] max-w-5xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Search className="h-7 w-7" />
          </div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Explore the marketplace
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
            What are you looking for?
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Use Search in the navbar to find products, stores, and categories.
          </p>
        </main>
      </CustomerLayout>
    );
  }

  const [productsResult, vendors] = await Promise.all([
    serverGetProducts({ limit: 24, page: 1, search, sort: "newest" }),
    serverGetVendors({ search, limit: 6 }),
  ]);

  return (
    <ProductCatalogView
      initialCategories={categories}
      initialProducts={productsResult.data}
      initialMeta={productsResult.meta ?? undefined}
      initialVendors={vendors}
      initialFilters={{ search, sort: "newest" }}
      searchPage
    />
  );
}

"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { publicVendorService } from "@/api";
import type { CategoryResponseDto } from "@/api/dto/category";
import type { VendorResponseDto } from "@/api/dto/vendor";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { Input } from "@/component/ui/input";
import { useQuery } from "@tanstack/react-query";
import { Search,Sparkles,Store,X } from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useDeferredValue, useMemo, useState } from "react";

const EMPTY_VENDORS: VendorResponseDto[] = [];

function getStoreInitials(name: string): string {
  if (!name) return "CR";
  const words = name.trim().split(/\s+/);
  const first = words[0];
  const second = words[1];
  if (!first) return "CR";
  if (words.length === 1 || !second) {
    return first.slice(0, 2).toUpperCase();
  }
  return ((first[0] ?? "") + (second[0] ?? "")).toUpperCase() || "CR";
}

const EMPTY_CATEGORIES: CategoryResponseDto[] = [];

export interface VendorsPageViewProps {
  initialCategories: CategoryResponseDto[];
  initialVendors?: VendorResponseDto[];
}

export function VendorsPageView({
  initialCategories,
  initialVendors,
}: VendorsPageViewProps) {
  const vendorsList = initialVendors ?? EMPTY_VENDORS;
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput.trim());

  // Categories delivered directly via RSC props
  const categories = initialCategories ?? EMPTY_CATEGORIES;
  const rootCategories = useMemo(
    () => categories.filter((c) => !c.parentId),
    [categories],
  );

  // Pre-build hierarchy map from categories so any subcategory strictly resolves to its root main category
  const categoryToRootMap = useMemo(() => {
    const catById = new Map<string, CategoryResponseDto>();
    for (const cat of categories) {
      catById.set(cat.id, cat);
      if (cat.slug) catById.set(cat.slug, cat);
    }

    const mapping = new Map<string, { id: string; name: string }>();

    for (const cat of categories) {
      let current: CategoryResponseDto | undefined = cat;
      while (current && current.parentId) {
        current = catById.get(current.parentId);
      }
      if (current && !current.parentId) {
        const rootInfo = { id: current.id, name: current.name };
        mapping.set(cat.id, rootInfo);
        if (cat.slug) mapping.set(cat.slug, rootInfo);
        if (cat.name) mapping.set(cat.name.toLowerCase(), rootInfo);
      }
    }

    // Also register root categories directly
    for (const root of rootCategories) {
      const rootInfo = { id: root.id, name: root.name };
      mapping.set(root.id, rootInfo);
      if (root.slug) mapping.set(root.slug, rootInfo);
      if (root.name) mapping.set(root.name.toLowerCase(), rootInfo);
    }

    return mapping;
  }, [categories, rootCategories]);

  const isFiltered = selectedCategoryId !== "ALL" || search.length > 0;

  // Live database-backed query for vendor directory with debounced search & category filtering
  const vendorsQuery = useQuery({
    queryKey: ["vendors-public-list", selectedCategoryId, search],
    queryFn: async ({ signal }) => {
      const res = await publicVendorService.list(
        {
          categoryId: selectedCategoryId !== "ALL" ? selectedCategoryId : undefined,
          search: search || undefined,
          limit: 50,
        },
        signal,
      );
      return res.data ?? [];
    },
    initialData: !isFiltered && vendorsList.length > 0 ? vendorsList : undefined,
    placeholderData: (previousData) => previousData,
    staleTime: 1000 * 60 * 5,
  });

  const displayedVendors = vendorsQuery.data ?? (isFiltered ? [] : vendorsList);
  const isLoadingVendors = vendorsQuery.isLoading;

  return (
    <CustomerLayout categories={categories}>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6 border-b border-neutral-200/80 pb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Discover Our Vendors
            </h1>
            <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl">
              Shop directly from verified independent vendors and local artisans across Nigeria.
            </p>
          </div>

          {/* Search bar */}
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="vendors-search-input"
              name="vendorSearch"
              aria-label="Search stores by name"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search stores by name..."
              className="h-10 rounded-full border-border bg-secondary/50 pl-10 pr-9 text-sm focus:bg-background"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)] gap-8 items-start">
          {/* Left Column: Vertical Category Filter Pills */}
          <aside
            aria-label="Filter vendors by category"
            className="flex gap-2 overflow-x-auto pb-2 lg:sticky lg:top-24 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {/* "All Stores" Pill */}
            <button
              type="button"
              onClick={() => setSelectedCategoryId("ALL")}
              aria-pressed={selectedCategoryId === "ALL"}
              className={`w-max max-w-[75vw] shrink-0 flex items-center gap-3 rounded-full border px-4 py-2.5 text-sm font-medium transition-all lg:w-full lg:max-w-none ${
                selectedCategoryId === "ALL"
                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                  : "bg-card text-foreground border-border hover:bg-secondary"
              }`}
            >
              <div className="flex h-5 w-5 items-center justify-center shrink-0">
                <Sparkles className="h-4 w-4" />
              </div>
              <span className="min-w-0 truncate">All Stores</span>
            </button>

            {/* Dynamic Root Categories from DB */}
            {rootCategories.map((cat) => {
              const isSelected = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(cat.id)}
                  aria-pressed={isSelected}
                  className={`w-max max-w-[75vw] shrink-0 flex items-center gap-3 rounded-full border px-4 py-2.5 text-sm font-semibold transition-all lg:w-full lg:max-w-none ${
                    isSelected
                      ? "bg-primary text-primary-foreground border-primary shadow-xs"
                      : "bg-card text-foreground border-border hover:bg-secondary"
                  }`}
                >
                  <div className="flex h-5 w-5 items-center justify-center shrink-0">
                    {cat.imageUrl ? (
                      <RemoteImage
                        src={cat.imageUrl}
                        alt={cat.name}
                        className="h-4 w-4 object-contain"
                      />
                    ) : (
                      <span className="text-xs font-bold">{cat.name.charAt(0)}</span>
                    )}
                  </div>
                  <span className="min-w-0 truncate">{cat.name}</span>
                </button>
              );
            })}
          </aside>

          {/* Right Column: 3-Column Vendor Cards Grid */}
          <section>
            {isLoadingVendors ? (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-56 animate-pulse rounded-2xl bg-neutral-100" />
                ))}
              </div>
            ) : !displayedVendors || displayedVendors.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border py-20 text-center">
                <p className="font-semibold text-foreground">
                  No stores found in this category
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try selecting &ldquo;All Stores&rdquo; to browse all stores.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategoryId("ALL");
                    setSearchInput("");
                  }}
                  className="mt-5 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-xs"
                >
                  Show All Stores
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {displayedVendors.map((vendor) => {
                  const initials = getStoreInitials(vendor.storeName);
                  const rawCategories = vendor.categories ?? [];

                  // Resolve every category tag to its root main category if mapped, or preserve category name, and deduplicate
                  const mainCategoriesMap = new Map<string, { id: string; name: string }>();
                  for (const c of rawCategories) {
                    const root =
                      categoryToRootMap.get(c.id) ||
                      (c.slug ? categoryToRootMap.get(c.slug) : undefined) ||
                      (c.name ? categoryToRootMap.get(c.name.toLowerCase()) : undefined);

                    if (root) {
                      mainCategoriesMap.set(root.id, root);
                    } else if (c.name) {
                      mainCategoriesMap.set(c.id || c.name, { id: c.id || c.name, name: c.name });
                    }
                  }
                  const vendorMainCategories = Array.from(mainCategoriesMap.values());

                  return (
                    <Link
                      key={vendor.storeSlug}
                      href={`/vendor/${vendor.storeSlug}`}
                      className="group flex flex-col justify-between rounded-2xl border border-border bg-card p-3 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
                    >
                      <div>
                        {/* Banner Image Container */}
                        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-secondary">
                          {vendor.storeLogoUrl ? (
                            <RemoteImage
                              src={vendor.storeLogoUrl}
                              alt={vendor.storeName}
                              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-secondary text-muted-foreground">
                              <Store className="h-10 w-10 stroke-[1.2]" />
                            </div>
                          )}
                        </div>

                        {/* Overlapping Brand Logo Avatar */}
                        <div className="relative -mt-6 ml-3 h-12 w-12 rounded-full border-2 border-border bg-card shadow-sm overflow-hidden flex items-center justify-center font-bold text-foreground text-sm z-10">
                          {vendor.storeLogoUrl ? (
                            <RemoteImage
                              src={vendor.storeLogoUrl}
                              alt={vendor.storeName}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span>{initials}</span>
                          )}
                        </div>

                        {/* Store Info */}
                        <div className="mt-2 px-1">
                          <h2 className="font-semibold text-base sm:text-lg text-foreground truncate group-hover:text-primary transition-colors">
                            {vendor.storeName}
                          </h2>

                          {/* Category Tags at Bottom - Shows ALL categories the vendor belongs to */}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                            {vendorMainCategories.length > 0 ? (
                              vendorMainCategories.map((c) => (
                                <span
                                  key={c.id}
                                  className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-[11px] font-medium text-secondary-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary"
                                >
                                  {c.name}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">Vendor Store</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </CustomerLayout>
  );
}

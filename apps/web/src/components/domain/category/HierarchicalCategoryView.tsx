"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/navigation/AppLink";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { ProductCard } from "@/component/product/ProductCard";
import { ProductDetailView } from "@/component/product/ProductDetailView";
import { ProductGridSkeleton } from "@/component/product/ProductGridSkeleton";
import { CategoryFilterDrawer } from "@/component/category/CategoryFilterDrawer";
import { useQuery } from "@tanstack/react-query";
import { productService } from "@/api";
import type { CategoryResponseDto } from "@/api/dto/category";
import type { ProductCardDto, PublicProductResponseDto } from "@/api/dto/product";
import type { CategoryProductPreview } from "@/api/modules/product";
import type { ProductReviewsMetaDto, ReviewResponseDto } from "@/api/dto/review";
import {
  ChevronRight,
  Home,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { getNodeChildren, resolveCategoryPath } from "@/lib/category-tree";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { analyticsEventService } from "@/api/modules/analytics";
import { createRecommendationRequestId, getRecommendationSessionId } from "@/lib/recommendation-session";
import { useAuthStore } from "@/zustand/auth";

export interface HierarchicalCategoryViewProps {
  slugs: string[];
  initialCategories: CategoryResponseDto[];
  initialCategoryNode?: CategoryResponseDto | null;
  initialProducts: ProductCardDto[];
  initialProductMeta?: { totalItems?: number; total?: number; totalPages?: number } | null;
  initialTopPicks?: ProductCardDto[];
  initialCategoryPreviews?: Record<string, CategoryProductPreview>;
  initialProduct?: PublicProductResponseDto | null;
  initialReviews?: { data: ReviewResponseDto[]; meta?: ProductReviewsMetaDto } | null;
  initialSearchParams?: {
    search?: string;
    sort?: string;
    minPrice?: string;
    maxPrice?: string;
    inStock?: boolean;
  };
}

export function HierarchicalCategoryView({
  slugs,
  initialCategories,
  initialCategoryNode,
  initialProducts,
  initialProductMeta,
  initialTopPicks = [],
  initialCategoryPreviews = {},
  initialProduct,
  initialReviews,
  initialSearchParams,
}: HierarchicalCategoryViewProps) {
  // If the path resolves to an individual product, render the Product Detail View
  if (initialProduct) {
    return (
      <ProductDetailView
        slug={initialProduct.slug || slugs[slugs.length - 1] || ""}
        initialProduct={initialProduct}
        initialReviews={initialReviews}
        categories={initialCategories}
      />
    );
  }

  return (
    <CategoryCatalogContent
      key={`${slugs.join("/")}:${JSON.stringify(initialSearchParams ?? {})}`}
      slugs={slugs}
      categories={initialCategories}
      categoryNode={initialCategoryNode}
      initialProducts={initialProducts}
      initialProductMeta={initialProductMeta}
      initialTopPicks={initialTopPicks}
      initialCategoryPreviews={initialCategoryPreviews}
      initialFilters={initialSearchParams}
    />
  );
}

function CategoryCatalogContent({
  slugs,
  categories,
  categoryNode,
  initialProducts,
  initialProductMeta,
  initialTopPicks,
  initialCategoryPreviews,
  initialFilters,
}: {
  slugs: string[];
  categories: CategoryResponseDto[];
  categoryNode?: CategoryResponseDto | null;
  initialProducts: ProductCardDto[];
  initialProductMeta?: { totalItems?: number; total?: number; totalPages?: number } | null;
  initialTopPicks: ProductCardDto[];
  initialCategoryPreviews: Record<string, CategoryProductPreview>;
  initialFilters?: {
    search?: string;
    sort?: string;
    minPrice?: string;
    maxPrice?: string;
    inStock?: boolean;
  };
}) {
  const [searchInput, setSearchInput] = useState(initialFilters?.search || "");
  const search = useDebouncedValue(searchInput.trim(), 250);
  const [sortBy, setSortBy] = useState(initialFilters?.sort || "newest");
  const [minPrice, setMinPrice] = useState(initialFilters?.minPrice || "");
  const [maxPrice, setMaxPrice] = useState(initialFilters?.maxPrice || "");
  const [inStock, setInStock] = useState(Boolean(initialFilters?.inStock));
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [activeSubcategorySlug, setActiveSubcategorySlug] = useState<string | null>(null);

  // Compute category ancestry and direct child categories
  const traversal = useMemo(() => resolveCategoryPath(categories, slugs), [categories, slugs]);
  const activeCategory = categoryNode || traversal.matchedNode;
  const isRootCategory = Boolean(activeCategory && (activeCategory.isRoot || !activeCategory.parentId));
  const trackedCategoryRef = useRef("");
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const canPurchase = useAuthStore((state) => state.capabilities?.canPurchase ?? false);

  useEffect(() => {
    if (
      !activeCategory?.id ||
      (isAuthenticated && !canPurchase) ||
      trackedCategoryRef.current === activeCategory.id
    ) return;
    const sessionId = getRecommendationSessionId();
    const requestId = createRecommendationRequestId();
    if (!sessionId || !requestId) return;
    const categoryId = activeCategory.id;
    trackedCategoryRef.current = categoryId;
    void analyticsEventService.trackRecommendation(
      {
        requestId,
        surface: "CATEGORY_BROWSE",
        rankerVersion: "behavior-v1",
        position: 0,
        sessionId,
      },
      "CATEGORY_VIEW",
      { categoryId },
      isAuthenticated && canPurchase,
    ).catch(() => {
      if (trackedCategoryRef.current === categoryId) trackedCategoryRef.current = "";
    });
  }, [activeCategory?.id, canPurchase, isAuthenticated]);

  // Direct subcategories under current level
  const subcategories = useMemo(() => {
    if (!activeCategory) return [];
    return getNodeChildren(activeCategory).filter(
      (category) => category.isActive && category.status === "ACTIVE",
    );
  }, [activeCategory]);

  useEffect(() => {
    if (!isRootCategory) return;

    const sections = [
      { element: document.getElementById("category-top-picks"), slug: null },
      ...subcategories.map((subcategory) => ({
        element: document.getElementById(`subcategory-${subcategory.slug}`),
        slug: subcategory.slug,
      })),
    ].filter((section): section is { element: HTMLElement; slug: string | null } => Boolean(section.element));

    const updateActiveSection = () => {
      const activationLine = Math.min(240, Math.max(120, window.innerHeight * 0.3));
      let currentSlug: string | null = null;

      for (const section of sections) {
        if (section.element.getBoundingClientRect().top > activationLine) break;
        currentSlug = section.slug;
      }

      setActiveSubcategorySlug(currentSlug);
    };

    const frame = window.requestAnimationFrame(updateActiveSection);
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    window.addEventListener("hashchange", updateActiveSection);
    window.addEventListener("popstate", updateActiveSection);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
      window.removeEventListener("hashchange", updateActiveSection);
      window.removeEventListener("popstate", updateActiveSection);
    };
  }, [isRootCategory, subcategories]);

  const currentCategoryHref = `/category/${slugs.map((slug) => encodeURIComponent(slug)).join("/")}`;
  const activeFilterCount =
    Number(Boolean(minPrice || maxPrice)) + Number(inStock) + Number(!isRootCategory && sortBy !== "newest");

  // Construct dynamic breadcrumb ancestry
  const breadcrumbs = useMemo(() => {
    const crumbs: Array<{ label: string; href: string }> = [
      { label: "Home", href: "/" },
    ];

    if (traversal.breadcrumbs && traversal.breadcrumbs.length > 0) {
      for (const b of traversal.breadcrumbs) {
        crumbs.push({ label: b.name, href: b.href });
      }
    } else {
      let accumulatedPath = "/category";
      for (const node of traversal.matchedChain) {
        accumulatedPath += `/${encodeURIComponent(node.slug)}`;
        crumbs.push({
          label: node.name,
          href: accumulatedPath,
        });
      }
    }

    return crumbs;
  }, [traversal.breadcrumbs, traversal.matchedChain]);
  const selectedSubcategory = isRootCategory
    ? subcategories.find((subcategory) => subcategory.slug === activeSubcategorySlug)
    : undefined;
  const visibleBreadcrumbs = selectedSubcategory
    ? [
        ...breadcrumbs,
        {
          label: selectedSubcategory.name,
          href: `${currentCategoryHref}/${encodeURIComponent(selectedSubcategory.slug)}`,
        },
      ]
    : breadcrumbs;

  // Database-backed live product query for this category
  const minPriceNum = minPrice.trim() ? Number(minPrice) : undefined;
  const maxPriceNum = maxPrice.trim() ? Number(maxPrice) : undefined;

  const initialPageMatchesFilters =
    search === (initialFilters?.search || "") &&
    sortBy === (initialFilters?.sort || "newest") &&
    minPrice === (initialFilters?.minPrice || "") &&
    maxPrice === (initialFilters?.maxPrice || "") &&
    inStock === Boolean(initialFilters?.inStock);

  const productQuery = useQuery({
    queryKey: [
      "category-products",
      activeCategory?.id || slugs.join("/"),
      search,
      sortBy,
      minPrice,
      maxPrice,
      inStock,
      page,
    ],
    queryFn: async ({ signal }) => {
      if (!activeCategory?.id) return { items: [], totalItems: 0, totalPages: 1 };
      const res = await productService.getCards(
        {
          categoryId: activeCategory.id,
          search: search || undefined,
          sort: sortBy,
          minPrice: Number.isFinite(minPriceNum) ? minPriceNum : undefined,
          maxPrice: Number.isFinite(maxPriceNum) ? maxPriceNum : undefined,
          inStock: inStock || undefined,
          page,
          limit: 24,
        },
        signal,
      );
      return {
        items: res.data ?? [],
        totalItems: Number(res.meta?.totalItems ?? res.meta?.total ?? 0),
        totalPages: Math.max(1, Number(res.meta?.totalPages ?? 1)),
      };
    },
    enabled: Boolean(activeCategory?.id && !isRootCategory),
    initialData: page === 1 && initialPageMatchesFilters
      ? {
          items: initialProducts,
          totalItems: Number(initialProductMeta?.totalItems ?? initialProductMeta?.total ?? initialProducts.length),
          totalPages: Math.max(1, Number(initialProductMeta?.totalPages ?? 1)),
        }
      : undefined,
    staleTime: 1000 * 60 * 3,
  });

  const topPicksQuery = useQuery({
    queryKey: ["category-top-picks", activeCategory?.id, search, minPrice, maxPrice, inStock],
    queryFn: async () => {
      if (!activeCategory?.id) return [];
      const response = await productService.getTrending({
        categoryId: activeCategory.id,
        limit: 12,
        days: 30,
        search: search || undefined,
        minPrice: Number.isFinite(minPriceNum) ? minPriceNum : undefined,
        maxPrice: Number.isFinite(maxPriceNum) ? maxPriceNum : undefined,
      });
      return response.data ?? [];
    },
    enabled: Boolean(activeCategory?.id && isRootCategory),
    initialData:
      initialTopPicks.length > 0 && !search && !minPrice && !maxPrice && !inStock
        ? initialTopPicks
        : undefined,
    staleTime: 1000 * 60 * 3,
  });

  const products = productQuery.data?.items ?? initialProducts;
  const isLoading = !isRootCategory && productQuery.isLoading;

  return (
    <CustomerLayout categories={categories}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {visibleBreadcrumbs.length > 2 && (
          <nav aria-label="Category hierarchy" className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {visibleBreadcrumbs.map((crumb, idx) => {
              const isLast = idx === visibleBreadcrumbs.length - 1;
              return (
                <span key={crumb.href} className="inline-flex items-center gap-1.5">
                  {idx === 0 ? (
                    <Link href={crumb.href} className="inline-flex items-center gap-1 hover:text-foreground">
                      <Home className="h-3.5 w-3.5" />
                      <span>Home</span>
                    </Link>
                  ) : isLast ? (
                    <span className="font-semibold text-foreground" aria-current="page">{crumb.label}</span>
                  ) : (
                    <Link href={crumb.href} className="hover:text-foreground">{crumb.label}</Link>
                  )}
                  {!isLast && <ChevronRight className="h-3 w-3 text-muted-foreground/70" />}
                </span>
              );
            })}
          </nav>
        )}

        <div className="mb-8">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {activeCategory?.name || slugs[slugs.length - 1] || "Category"}
          </h1>
          {activeCategory?.description && (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
              {activeCategory.description}
            </p>
          )}

          <div className="mt-6 flex items-center gap-6 border-b border-border">
            <nav aria-label="Browse subcategories" className="flex min-w-0 flex-1 snap-x gap-7 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {isRootCategory ? (
                <a
                  href="#category-top-picks"
                  aria-current={activeSubcategorySlug === null ? "location" : undefined}
                  onClick={(event) => {
                    setActiveSubcategorySlug(null);
                    if (window.location.hash === "#category-top-picks") {
                      event.preventDefault();
                      document.getElementById("category-top-picks")?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }
                  }}
                  className={`shrink-0 border-b-2 px-1 pb-3 text-sm font-semibold transition-colors ${
                    activeSubcategorySlug === null
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  Top Picks
                </a>
              ) : (
                <span aria-current="page" className="shrink-0 border-b-2 border-foreground px-1 pb-3 text-sm font-semibold text-foreground">
                  {activeCategory?.name || "Products"}
                </span>
              )}
              {subcategories.map((sub) => (
                isRootCategory ? (
                  <a
                    key={sub.id}
                    href={`#subcategory-${encodeURIComponent(sub.slug)}`}
                    aria-current={activeSubcategorySlug === sub.slug ? "location" : undefined}
                    onClick={(event) => {
                      setActiveSubcategorySlug(sub.slug);
                      if (window.location.hash === `#subcategory-${encodeURIComponent(sub.slug)}`) {
                        event.preventDefault();
                        document.getElementById(`subcategory-${sub.slug}`)?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                      }
                    }}
                    className={`shrink-0 border-b-2 px-1 pb-3 text-sm transition-colors hover:border-border hover:text-foreground ${
                      activeSubcategorySlug === sub.slug
                        ? "border-foreground font-semibold text-foreground"
                        : "border-transparent text-muted-foreground"
                    }`}
                  >
                    {sub.name}
                  </a>
                ) : (
                  <Link
                    key={sub.id}
                    href={`${currentCategoryHref}/${encodeURIComponent(sub.slug)}`}
                    className="shrink-0 border-b-2 border-transparent px-1 pb-3 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                  >
                    {sub.name}
                  </Link>
                )
              ))}
            </nav>
            <button
              type="button"
              onClick={() => setIsFilterDrawerOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={isFilterDrawerOpen}
              className="mb-2 inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Filters
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-xs text-background">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {isRootCategory ? (
          <>
            <section id="category-top-picks" className="scroll-mt-24" aria-labelledby="category-top-picks-heading">
              <div className="mb-6">
                <h2 id="category-top-picks-heading" className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Top Picks</h2>
                {search && <p className="mt-1 text-sm text-muted-foreground">Matching: {search}</p>}
              </div>
              {topPicksQuery.isLoading ? (
                <ProductGridSkeleton count={8} />
              ) : (topPicksQuery.data ?? []).length > 0 ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 sm:gap-x-6 sm:gap-y-10">
                  {(topPicksQuery.data ?? []).map((product, index) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      categoryPath={currentCategoryHref}
                      priority={index < 4}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-border py-16 text-center">
                  <Search className="mx-auto h-10 w-10 text-muted-foreground" />
                  <h3 className="mt-4 text-base font-bold text-foreground">No best-selling products match these filters</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Try a wider price range or clear your search.</p>
                </div>
              )}
            </section>

            {subcategories.map((subcategory) => (
              <CategoryPreviewSection
                key={`${subcategory.id}:${search}:${sortBy}:${minPriceNum ?? ""}:${maxPriceNum ?? ""}:${inStock}`}
                category={subcategory}
                categoryHref={`${currentCategoryHref}/${encodeURIComponent(subcategory.slug)}`}
                initialPreview={initialCategoryPreviews[subcategory.id]}
                search={search}
                sortBy={sortBy}
                minPrice={minPriceNum}
                maxPrice={maxPriceNum}
                inStock={inStock}
              />
            ))}
          </>
        ) : (
          <>
            <div className="mb-6 flex items-end justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                  {activeCategory?.name || "Products"}
                </h2>
                {search && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Matching “{search}”
                  </p>
                )}
              </div>
            </div>
            {isLoading ? (
              <div className="py-8"><ProductGridSkeleton count={8} /></div>
            ) : products.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border py-20 text-center">
                <Search className="mx-auto h-10 w-10 text-muted-foreground" />
                <h3 className="mt-4 text-base font-bold text-foreground">No products found in this category</h3>
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                  {search ? "Try another search or browse a subcategory above." : "Products in this section are currently being updated by our vendors."}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 sm:gap-x-6 sm:gap-y-10">
                  {products.map((product, index) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      categoryPath={currentCategoryHref}
                      priority={index < 4}
                    />
                  ))}
                </div>
                <div className="mt-8 flex items-center justify-between text-sm text-muted-foreground">
                  <span>Page {page} of {productQuery.data?.totalPages ?? 1}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || productQuery.isFetching} className="rounded-lg border border-border px-3 py-2 disabled:opacity-40">Previous</button>
                    <button type="button" onClick={() => setPage((current) => Math.min(productQuery.data?.totalPages ?? current, current + 1))} disabled={page >= (productQuery.data?.totalPages ?? 1) || productQuery.isFetching} className="rounded-lg border border-border px-3 py-2 disabled:opacity-40">Next</button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <CategoryFilterDrawer
        isOpen={isFilterDrawerOpen}
        onClose={() => setIsFilterDrawerOpen(false)}
        minPrice={minPrice}
        maxPrice={maxPrice}
        onMinPriceChange={(value) => {
          setPage(1);
          setMinPrice(value);
        }}
        onMaxPriceChange={(value) => {
          setPage(1);
          setMaxPrice(value);
        }}
        inStock={inStock}
        onInStockChange={(value) => {
          setPage(1);
          setInStock(value);
        }}
        sortBy={sortBy}
        onSortByChange={(value) => {
          setPage(1);
          setSortBy(value);
        }}
        searchValue={searchInput}
        onSearchChange={(value) => {
          setPage(1);
          setSearchInput(value);
        }}
        onReset={() => {
          setPage(1);
          setMinPrice("");
          setMaxPrice("");
          setInStock(false);
          setSortBy("newest");
          setSearchInput("");
        }}
        showSort={!isRootCategory}
      />
    </CustomerLayout>
  );
}

function CategoryPreviewSection({
  category,
  categoryHref,
  initialPreview,
  search,
  sortBy,
  minPrice,
  maxPrice,
  inStock,
}: {
  category: CategoryResponseDto;
  categoryHref: string;
  initialPreview?: CategoryProductPreview;
  search: string;
  sortBy: string;
  minPrice?: number;
  maxPrice?: number;
  inStock: boolean;
}) {
  const hasDefaultFilters = !search && minPrice === undefined && maxPrice === undefined && !inStock && sortBy === "newest";
  const query = useQuery({
    queryKey: ["category-preview", category.id, search, sortBy, minPrice, maxPrice, inStock],
    queryFn: async ({ signal }) => {
      const response = await productService.getCards({
        categoryId: category.id,
        search: search || undefined,
        sort: sortBy,
        minPrice,
        maxPrice,
        inStock: inStock || undefined,
        page: 1,
        limit: 12,
      }, signal);
      return {
        items: response.data ?? [],
        totalItems: Number(response.meta?.totalItems ?? response.meta?.total ?? 0),
        totalPages: Math.max(1, Number(response.meta?.totalPages ?? 1)),
      };
    },
    enabled: true,
    initialData: hasDefaultFilters && initialPreview ? initialPreview : undefined,
    staleTime: 1000 * 60 * 3,
  });
  const items = query.data?.items ?? [];

  return (
    <section id={`subcategory-${category.slug}`} className="mt-14 scroll-mt-24" aria-labelledby={`subcategory-heading-${category.id}`}>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 id={`subcategory-heading-${category.id}`} className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {category.name}
          </h2>
          {search && (
            <p className="mt-1 text-sm text-muted-foreground">
              Matching “{search}”
            </p>
          )}
        </div>
        <Link href={categoryHref} className="shrink-0 text-sm font-semibold text-foreground underline-offset-4 hover:underline">
          View all
        </Link>
      </div>

      {query.isLoading ? (
        <ProductGridSkeleton count={4} />
      ) : items.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 sm:gap-x-6 sm:gap-y-8">
          {items.map((product, index) => (
            <ProductCard key={product.id} product={product} categoryPath={categoryHref} priority={index < 2} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {search ? "No products match these filters." : "No products are listed here yet."}
        </p>
      )}
    </section>
  );
}

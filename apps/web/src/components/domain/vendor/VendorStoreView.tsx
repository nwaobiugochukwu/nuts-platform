"use client";

import { RemoteImage } from "@/component/ui/RemoteImage";
import { publicVendorService } from "@/api";
import { analyticsEventService } from "@/api/modules/analytics";
import { isApiClientError } from "@/api/core/error";
import type { CategoryResponseDto } from "@/api/dto/category";
import type { PublicProductResponseDto } from "@/api/dto/product";
import type { VendorStoreDto } from "@/api/dto/vendor";
import { CategoryFilterDrawer } from "@/component/category/CategoryFilterDrawer";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { ProductCard } from "@/component/product/ProductCard";
import { ProductGridSkeleton } from "@/component/product/ProductGridSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import {
ArrowLeft,
CheckCircle2,
Search,
Share2,
ShoppingBag,
SlidersHorizontal,
Store,
X,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo,useRef,useState } from "react";
import { toast } from "sonner";
import { useVendorFollowing } from "@/hooks/use-vendor-following";
import { useAuthStore } from "@/zustand/auth";
import { getRecommendationSessionId, getRecommendationVisitorId } from "@/lib/recommendation-session";

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

interface RootCategoryGroup {
  id: string;
  name: string;
  slug: string;
  products: PublicProductResponseDto[];
}

export interface VendorStoreViewProps {
  slug: string;
  initialStore: VendorStoreDto | null;
  initialProducts: PublicProductResponseDto[];
  initialCategories: CategoryResponseDto[];
}

export function VendorStoreView({
  slug: propSlug,
  initialStore,
  initialProducts,
  initialCategories,
}: VendorStoreViewProps) {
  const router = useRouter();
  const params = useParams();
  const slug = (params?.slug as string) || propSlug;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isCustomer = useAuthStore((state) => state.isAuthenticated && (state.capabilities?.canPurchase ?? false));
  const { followedIds, isLoading: isLoadingFollows, isPending: isFollowPending, setFollowing } = useVendorFollowing();

  // State
  const [searchInput, setSearchInput] = useState("");
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [inStock, setInStock] = useState(false);
  const [sortBy, setSortBy] = useState("newest");
  const [activeTab, setActiveTab] = useState<string>("");

  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const trackedStoreViewRef = useRef("");

  // 1. Fetch Store Profile (hydrated with server store)
  const {
    data: store,
    isLoading: storeLoading,
    isError: storeRequestFailed,
    error: storeError,
    isFetching: storeFetching,
    refetch: retryStore,
  } = useQuery({
    queryKey: ["vendor-store", slug],
    queryFn: async () => {
      const { data } = await publicVendorService.getStore(slug);
      return data;
    },
    initialData: initialStore ?? undefined,
    staleTime: 1000 * 60 * 5,
    enabled: !!slug,
  });

  // 2. Fetch Store Products (hydrated with server products)
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["vendor-products", slug],
    queryFn: async () => {
      const { data } = await publicVendorService.getProducts(slug);
      return data;
    },
    // An empty array can mean a genuine empty store or a failed SSR fetch.
    // Refetch once in the browser rather than treating a transient failure as
    // fresh empty data for the full stale window.
    initialData: initialStore && initialProducts.length > 0
      ? { store: initialStore, products: initialProducts }
      : undefined,
    staleTime: 1000 * 60 * 5,
    enabled: !!slug,
  });

  const followerCountQuery = useQuery({
    queryKey: ["vendor-follower-count", slug],
    queryFn: async ({ signal }) => (await publicVendorService.followerCount(slug, signal)).data,
    enabled: Boolean(slug),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!store?.id || (isAuthenticated && !isCustomer)) return;
    const sessionId = getRecommendationSessionId();
    const visitorId = getRecommendationVisitorId();
    if (!sessionId || !visitorId) return;
    const trackingKey = `${store.id}:${sessionId}`;
    if (trackedStoreViewRef.current === trackingKey) return;
    trackedStoreViewRef.current = trackingKey;
    void analyticsEventService
      .trackStoreView(store.id, sessionId, visitorId, isAuthenticated && isCustomer)
      .catch(() => {
        if (trackedStoreViewRef.current === trackingKey) trackedStoreViewRef.current = "";
      });
  }, [isAuthenticated, isCustomer, store?.id]);

  // Categories delivered directly via RSC props
  const categoryTree = initialCategories;

  // Flattened Map resolving every child/descendant category to its top-level Root Category
  const rootCategoryMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; slug: string }>();

    function registerDescendants(
      node: CategoryResponseDto,
      root: { id: string; name: string; slug: string }
    ) {
      if (node.id) map.set(node.id, root);
      if (node.slug) map.set(node.slug, root);

      const children = node.children || node.subCategories || [];
      if (Array.isArray(children)) {
        for (const child of children) {
          registerDescendants(child, root);
        }
      }
    }

    for (const rootNode of categoryTree) {
      if (!rootNode.id && !rootNode.slug) continue;
      const rootInfo = {
        id: rootNode.id || rootNode.slug,
        name: rootNode.name,
        slug: rootNode.slug || rootNode.id,
      };
      registerDescendants(rootNode, rootInfo);
    }

    return map;
  }, [categoryTree]);

  // Extract raw products
  const rawProducts: PublicProductResponseDto[] = useMemo(
    () => productsData?.products ?? initialProducts,
    [productsData, initialProducts],
  );

  // Group products strictly by Root Category
  const rootCategoryGroups: RootCategoryGroup[] = useMemo(() => {
    if (!rawProducts.length) return [];

    const groupMap = new Map<string, RootCategoryGroup>();

    for (const product of rawProducts) {
      // Trace category hierarchy: category, subcategory, parentSubcategory
      const categoryRefs = [
        product.category,
        product.subcategory,
        product.parentSubcategory,
      ].filter(Boolean);

      let rootInfo: { id: string; name: string; slug: string } | null = null;

      for (const cat of categoryRefs) {
        if (!cat) continue;
        if (cat.id && rootCategoryMap.has(cat.id)) {
          rootInfo = rootCategoryMap.get(cat.id)!;
          break;
        }
        if (cat.slug && rootCategoryMap.has(cat.slug)) {
          rootInfo = rootCategoryMap.get(cat.slug)!;
          break;
        }
      }

      if (!rootInfo) {
        const cat = product.category || product.subcategory || product.parentSubcategory;
        if (cat?.name) {
          rootInfo = {
            id: cat.id || cat.slug || cat.name,
            name: cat.name,
            slug: cat.slug || cat.name.toLowerCase().replace(/\s+/g, "-"),
          };
        }
      }

      const groupKey = rootInfo?.id || "uncategorized";
      const groupName = rootInfo?.name || "Other Products";
      const groupSlug = rootInfo?.slug || "other";

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          id: groupKey,
          name: groupName,
          slug: groupSlug,
          products: [],
        });
      }
      groupMap.get(groupKey)!.products.push(product);
    }

    return Array.from(groupMap.values());
  }, [rawProducts, rootCategoryMap]);

  // Main root categories where this vendor actually has active products
  const vendorMainCategories = useMemo(() => {
    return rootCategoryGroups
      .filter((g) => g.products.length > 0 && g.id !== "uncategorized")
      .map((g) => ({
        id: g.id,
        name: g.name,
        slug: g.slug,
      }));
  }, [rootCategoryGroups]);

  // Filter & sort products within each root category group
  const filteredGroups = useMemo(() => {
    return rootCategoryGroups
      .map((group) => {
        let prods = [...group.products];

        // Search filter
        if (searchInput.trim()) {
          const q = searchInput.toLowerCase().trim();
          prods = prods.filter(
            (p) =>
              p.name?.toLowerCase().includes(q) ||
              p.description?.toLowerCase().includes(q) ||
              p.sku?.toLowerCase().includes(q)
          );
        }

        // In Stock filter
        if (inStock) {
          prods = prods.filter((p) => (p.stock ?? 0) > 0);
        }

        // Price filters
        if (minPrice) {
          const min = parseFloat(minPrice);
          if (!isNaN(min)) prods = prods.filter((p) => Number(p.price) >= min);
        }
        if (maxPrice) {
          const max = parseFloat(maxPrice);
          if (!isNaN(max)) prods = prods.filter((p) => Number(p.price) <= max);
        }

        // Sorting
        if (sortBy === "price_asc") {
          prods.sort((a, b) => Number(a.price) - Number(b.price));
        } else if (sortBy === "price_desc") {
          prods.sort((a, b) => Number(b.price) - Number(a.price));
        } else {
          prods.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        }

        return { ...group, products: prods };
      })
      .filter((g) => g.products.length > 0);
  }, [rootCategoryGroups, searchInput, inStock, minPrice, maxPrice, sortBy]);


  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (minPrice) c++;
    if (maxPrice) c++;
    if (inStock) c++;
    if (sortBy !== "newest") c++;
    return c;
  }, [minPrice, maxPrice, inStock, sortBy]);

  const hasActiveFilters =
    Boolean(searchInput.trim()) || activeFilterCount > 0;

  const handleResetFilters = () => {
    setSearchInput("");
    setMinPrice("");
    setMaxPrice("");
    setInStock(false);
    setSortBy("newest");
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: store?.storeName || "Vendor Store",
          url,
        });
      } catch {
        // Fallback to clipboard
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Store link copied to clipboard");
    }
  };

  const handleFollowStore = async () => {
    if (!store) return;
    if (!isAuthenticated) {
      router.push(`/auth/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!isCustomer) return;
    const following = !followedIds.has(store.id);
    try {
      await setFollowing(store, following);
      toast.success(following ? `Following ${store.storeName}` : `Unfollowed ${store.storeName}`);
    } catch {
      toast.error(`Could not ${following ? "follow" : "unfollow"} this store. Please try again.`);
    }
  };

  const scrollToCategory = (catSlug: string) => {
    setActiveTab(catSlug);
    const element = document.getElementById(`cat-${catSlug}`);
    if (element) {
      const yOffset = -120;
      const y =
        element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  const isLoading = (storeLoading && !initialStore) || (productsLoading && !initialProducts);

  if (isLoading) {
    return (
      <CustomerLayout categories={categoryTree}>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <Skeleton className="h-52 w-full rounded-3xl mb-8" />
          <ProductGridSkeleton />
        </div>
      </CustomerLayout>
    );
  }

  if (!store) {
    const status = isApiClientError(storeError)
      ? storeError.response?.status
      : undefined;
    const requestUnavailable = storeRequestFailed && status !== 404;

    return (
      <CustomerLayout categories={categoryTree}>
        <div className="mx-auto max-w-7xl px-4 py-24 text-center sm:px-6 lg:px-8">
          <Store className="mx-auto h-12 w-12 text-muted-foreground/60" />
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
            {requestUnavailable ? "Store Temporarily Unavailable" : "Store Not Found"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {requestUnavailable
              ? "We couldn't load this store right now. Check your connection and try again."
              : "The vendor store you are looking for does not exist or has been disabled."}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            {requestUnavailable && (
              <button
                type="button"
                onClick={() => void retryStore()}
                disabled={storeFetching}
                className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {storeFetching ? "Retrying…" : "Try again"}
              </button>
            )}
            <Link
              href="/vendor"
              className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-xs"
            >
              Browse Vendors
            </Link>
          </div>
        </div>
      </CustomerLayout>
    );
  }

  const initials = getStoreInitials(store.storeName);

  return (
    <CustomerLayout categories={categoryTree}>
      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Back Link */}
        <div className="mb-6">
          <Link
            href="/vendor"
            className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>All Vendors</span>
          </Link>
        </div>

        {/* Store Profile Header */}
        <div className="relative mb-10 overflow-hidden rounded-3xl border border-border bg-card shadow-xs">
          {/* Cover / Gradient Backdrop */}
          <div className="h-44 sm:h-52 w-full bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900 relative">
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px]" />
            <div className="absolute top-4 right-4 z-10">
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-md px-3.5 py-1.5 text-xs font-medium text-white hover:bg-black/60 transition-colors"
                aria-label="Share Store"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>Share</span>
              </button>
            </div>
          </div>

          {/* Store Info Bar */}
          <div className="px-4 pb-5 pt-0 sm:px-8 sm:pb-8">
            <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 -mt-14 sm:-mt-16 mb-4">
              {/* Logo / Initials */}
              <div className="relative h-24 w-24 sm:h-28 sm:w-28 rounded-2xl border-4 border-card bg-card shadow-md overflow-hidden flex items-center justify-center font-bold text-2xl sm:text-3xl text-foreground shrink-0">
                {store.storeLogoUrl ? (
                  <RemoteImage
                    src={store.storeLogoUrl}
                    alt={store.storeLogoAltText || store.storeName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </div>

              {/* Badges / Stats */}
              {store.isVerified && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Verified Vendor
                  </span>
                </div>
              )}
            </div>

            {/* Store Name & Description */}
            <div className="max-w-3xl">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                  {store.storeName}
                </h1>
                {store.isVerified && (
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                )}
              </div>
              {store.storeDescription && (
                <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  {store.storeDescription}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  {followerCountQuery.isLoading ? "Loading followers…" : `${followerCountQuery.data?.count ?? 0} ${followerCountQuery.data?.count === 1 ? "follower" : "followers"}`}
                </span>
                {(isCustomer || !isAuthenticated) && (
                  <button
                    type="button"
                    onClick={() => void handleFollowStore()}
                    disabled={isCustomer && (isLoadingFollows || isFollowPending(store.id))}
                    className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background transition-opacity hover:opacity-85 disabled:opacity-50"
                  >
                    {isCustomer && isLoadingFollows
                      ? "Checking…"
                      : isCustomer && isFollowPending(store.id)
                        ? (followedIds.has(store.id) ? "Following…" : "Unfollowing…")
                        : isCustomer && followedIds.has(store.id)
                          ? "Following"
                          : "Follow store"}
                  </button>
                )}
              </div>
              {vendorMainCategories.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {vendorMainCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => scrollToCategory(cat.slug)}
                      className="inline-flex items-center rounded-full bg-secondary/80 px-2.5 py-0.5 text-xs font-medium text-foreground border border-border/50 hover:bg-secondary hover:border-primary/40 transition-colors cursor-pointer"
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* In-Store Search Bar */}
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search in store..."
              className="h-10 w-full rounded-full border border-border bg-secondary/40 pl-10 pr-9 text-xs sm:text-sm focus:bg-background focus:outline-hidden transition-colors"
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

          {/* Filter Trigger Button */}
          <button
            type="button"
            onClick={() => setIsFilterDrawerOpen(true)}
            className="flex items-center gap-1.5 self-start sm:self-auto rounded-full border border-border px-4 py-2 text-xs sm:text-sm font-medium text-foreground hover:bg-secondary transition-colors shrink-0"
          >
            <span>Filters</span>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Root Category Navigation Pill Tabs */}
        {filteredGroups.length > 1 && (
          <div className="mb-8 border-b border-border/60 pb-4">
            <div
              ref={tabsScrollRef}
              className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            >
              <button
                type="button"
                onClick={() => {
                  setActiveTab("");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className={`rounded-full px-4 py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                  !activeTab
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200"
                }`}
              >
                All Departments
              </button>
              {filteredGroups.map((group) => {
                const isSelected = activeTab === group.slug;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => scrollToCategory(group.slug)}
                    className={`rounded-full px-4 py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                      isSelected
                        ? "bg-black text-white dark:bg-white dark:text-black"
                        : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200"
                    }`}
                  >
                    {group.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Active Filter Chips */}
        {hasActiveFilters && (
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Active filters:</span>
            {searchInput && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
                &ldquo;{searchInput}&rdquo;
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="hover:text-primary transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {inStock && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
                In Stock Only
                <button
                  type="button"
                  onClick={() => setInStock(false)}
                  className="hover:text-primary transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {(minPrice || maxPrice) && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
                ₦{minPrice || "0"} – ₦{maxPrice || "Any"}
                <button
                  type="button"
                  onClick={() => {
                    setMinPrice("");
                    setMaxPrice("");
                  }}
                  className="hover:text-primary transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {sortBy !== "newest" && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
                Sort: {sortBy === "price_asc" ? "Price: Low to High" : "Price: High to Low"}
                <button
                  type="button"
                  onClick={() => setSortBy("newest")}
                  className="hover:text-primary transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={handleResetFilters}
              className="text-xs font-semibold text-primary underline hover:text-primary/80 ml-2 cursor-pointer"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Product Catalog Display */}
        {rawProducts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border py-20 text-center">
            <ShoppingBag className="mx-auto h-12 w-12 text-muted-foreground/60" />
            <h3 className="mt-4 text-base font-bold text-foreground">
              No products available yet
            </h3>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              {store.storeName} is currently crafting their upcoming collection.
            </p>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-16 text-center">
            <Search className="mx-auto h-8 w-8 text-muted-foreground/60" />
            <h3 className="mt-3 text-sm sm:text-base font-bold text-foreground">
              No products found
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {searchInput
                ? `No products match "${searchInput}" with active filters.`
                : "No products match the selected filters."}
            </p>
            <button
              type="button"
              onClick={handleResetFilters}
              className="mt-4 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-xs"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="space-y-12 sm:space-y-16">
            {filteredGroups.map((group, groupIndex) => (
              <section
                key={group.id}
                id={`cat-${group.slug}`}
                className="scroll-mt-28"
              >
                {/* Root Category Heading */}
                <div className="mb-6 flex items-center justify-between border-b border-border/40 pb-3">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                    {group.name}
                  </h2>
                </div>

                {/* Product Grid */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 sm:gap-x-6 sm:gap-y-10">
                  {group.products.map((product, pIdx) => (
                    <ProductCard
                      key={product.id}
                      product={{
                        id: product.id,
                        name: product.name,
                        slug: product.slug,
                        price: Number(product.discountPrice ?? product.price ?? 0),
                        discountPrice: product.discountPrice ?? null,
                        thumbnail: product.imageUrl ?? product.images[0]?.url ?? null,
                        stockStatus: product.stockStatus,
                        vendor: product.vendor,
                        category: product.category,
                        parentSubcategory: product.parentSubcategory,
                        subcategory: product.subcategory,
                      }}
                      addedFrom="PRODUCT_PAGE"
                      priority={groupIndex === 0 && pIdx < 4}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Filter Drawer */}
        <CategoryFilterDrawer
          key={isFilterDrawerOpen ? "open" : "closed"}
          isOpen={isFilterDrawerOpen}
          onClose={() => setIsFilterDrawerOpen(false)}
          minPrice={minPrice}
          maxPrice={maxPrice}
          onMinPriceChange={setMinPrice}
          onMaxPriceChange={setMaxPrice}
          inStock={inStock}
          onInStockChange={setInStock}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          onReset={handleResetFilters}
        />
      </div>
    </CustomerLayout>
  );
}

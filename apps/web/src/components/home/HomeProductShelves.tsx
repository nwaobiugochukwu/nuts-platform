"use client";

import type { ProductCardDto } from "@/api/dto/product";
import type { FeaturedVendorDto } from "@/api/dto/vendor";
import type { CategoryResponseDto } from "@/api/dto/category";
import { TrendingCarousel } from "@/components/domain/product/TrendingCarousel";
import { GoodPlaceToStartSection } from "@/components/home/GoodPlaceToStartSection";
import { ShopByInterestSection } from "@/components/home/ShopByInterestSection";
import { VendorDiscoverySection } from "@/components/home/VendorDiscoverySection";
import { TrendingSkeleton } from "@/components/feedback/TrendingSkeleton";
import Link from "@/components/navigation/AppLink";
import { usePersonalizedRecommendations } from "@/hooks/use-personalized-recommendations";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";

const MIN_PICKED_FOR_YOU_PRODUCTS = 1;

function uniqueProducts(
  products: ProductCardDto[],
  limit: number,
  excludedIds: Set<string> = new Set(),
) {
  const unique: ProductCardDto[] = [];
  const selectedIds = new Set<string>();
  for (const product of products) {
    if (selectedIds.has(product.id) || excludedIds.has(product.id)) continue;
    selectedIds.add(product.id);
    unique.push(product);
    if (unique.length === limit) break;
  }
  return unique;
}

export function HomeProductShelves({
  initialCategories,
  initialVendors = [],
  initialProducts = [],
}: {
  initialCategories: CategoryResponseDto[];
  /** Optional SSR-prefetched featured vendors. If omitted, skeleton loader displays until client recommendations resolve. */
  initialVendors?: FeaturedVendorDto[];
  /** Optional SSR-prefetched products for starter shelf. If omitted, skeleton loader displays until client recommendations resolve. */
  initialProducts?: ProductCardDto[];
}) {
  // Restore scroll position when navigating back from a product detail page.
  useScrollRestoration();

  const {
    products: forYou,
    starterPicks,
    isLoadingStarterPicks,
    isErrorStarterPicks,
    refetchStarterPicks,
    storesToDiscover,
    isLoadingStores,
    isErrorStores,
    refetchStores,
    recentlyViewed,
    fromFollowedVendors,
    sessionId,
    isAuthInitialized,
    isCustomer,
    isLoading: isLoadingForYou,
    isLoadingRecentlyViewed,
    isLoadingFollowing,
  } = usePersonalizedRecommendations();

  // Shelf priority, most personal first. Each shelf only excludes shelves that
  // rank above it, so a lower-priority generic shelf can never swallow the
  // personalised ones.
  const visibleRecent = uniqueProducts(recentlyViewed, 12);
  // Dedupe against higher-priority shelves only while that still leaves a
  // meaningful shelf; in a small catalog, overlap beats a near-empty row.
  const MIN_DEDUPED_SHELF = 6;
  const dedupeOrKeep = (
    products: ProductCardDto[],
    excluded: Set<string>,
  ) => {
    const deduped = uniqueProducts(products, 12, excluded);
    return deduped.length >= MIN_DEDUPED_SHELF || deduped.length === products.length
      ? deduped
      : uniqueProducts(products, 12);
  };
  const visibleFollowing = dedupeOrKeep(
    fromFollowedVendors,
    new Set(visibleRecent.map(({ id }) => id)),
  );
  const visibleForYou = dedupeOrKeep(
    forYou,
    new Set([...visibleRecent, ...visibleFollowing].map(({ id }) => id)),
  );
  const visibleStarterPicks = dedupeOrKeep(
    starterPicks,
    new Set(
      [...visibleRecent, ...visibleFollowing, ...visibleForYou].map(({ id }) => id),
    ),
  );
  const vendorCandidates = storesToDiscover.length > 0 ? storesToDiscover : initialVendors;
  const seenVendorIds = new Set<string>();
  const vendorsToExplore = vendorCandidates.filter((vendor) => {
    if (seenVendorIds.has(vendor.id)) return false;
    seenVendorIds.add(vendor.id);
    return true;
  }).slice(0, 12);

  // -------------------------------------------------------------------------
  // Loading state flags
  // -------------------------------------------------------------------------

  // True while we're still waiting for auth + sessionId to be established.
  const clientHydrating = !isAuthInitialized || !sessionId;

  // "A good place to start": show skeleton loader while client query resolves,
  // preventing jarring UI flashes where generic SSR items are suddenly replaced.
  const showStarterSkeleton = clientHydrating || isLoadingStarterPicks;
  const starterSettled = !clientHydrating && !isLoadingStarterPicks;
  const displayedStarterPicks =
    visibleStarterPicks.length > 0 ? visibleStarterPicks : initialProducts;

  // "New from followed vendors" — customer-only shelf.
  const showFollowingSkeleton = isCustomer && (clientHydrating || isLoadingFollowing);
  // Keep showing the last followed-stores data through brief auth refreshes.
  const followingSettled = !clientHydrating && !isLoadingFollowing;

  // "Vendors to explore": show skeleton loader while client query resolves.
  const showStoresSkeleton = clientHydrating || isLoadingStores;
  const storesSettled = !clientHydrating && !isLoadingStores;

  // Final fallback: shown only when everything is settled AND empty.
  const hasHomeContent = Boolean(
    displayedStarterPicks.length ||
    visibleRecent.length ||
    visibleForYou.length ||
    visibleFollowing.length ||
    initialCategories.length ||
    vendorsToExplore.length,
  );
  const everythingSettled =
    !clientHydrating &&
    !isLoadingStarterPicks &&
    !isLoadingRecentlyViewed &&
    !isLoadingForYou &&
    !isLoadingStores &&
    (!isCustomer || !isLoadingFollowing);

  return (
    <div className="space-y-14 pb-24 pt-8 sm:space-y-16">
      {/* ------------------------------------------------------------------ */}
      {/* 1. A good place to start                                            */}
      {/* Shows skeleton while recommendations resolve, then renders curated   */}
      {/* marketplace mix without jarring item swap flashes.                  */}
      {/* ------------------------------------------------------------------ */}
      {showStarterSkeleton && (
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8" aria-busy="true" aria-label="A good place to start — loading">
          <div className="space-y-6">
            <div className="flex items-start sm:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  A good place to start
                </h2>
                <span className="mt-1.5 inline-flex text-sm font-semibold text-muted-foreground sm:hidden">
                  Browse all finds
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden text-sm font-semibold text-muted-foreground sm:inline">Browse all finds</span>
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-secondary animate-pulse" />
                  <div className="h-9 w-9 rounded-full bg-secondary animate-pulse" />
                </div>
              </div>
            </div>

            <div className="flex gap-4 overflow-hidden pb-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="w-[220px] sm:w-[250px] shrink-0 space-y-3 rounded-2xl border border-border/40 p-3 bg-card/60"
                >
                  <div className="aspect-[4/5] w-full rounded-xl bg-secondary animate-pulse" />
                  <div className="h-4 w-3/4 rounded-md bg-secondary animate-pulse" />
                  <div className="h-3 w-1/2 rounded-md bg-secondary animate-pulse" />
                  <div className="h-5 w-1/3 rounded-md bg-secondary animate-pulse pt-1" />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      {starterSettled && (displayedStarterPicks.length > 0 || isErrorStarterPicks) && (
        <GoodPlaceToStartSection
          products={displayedStarterPicks}
          sessionId={sessionId}
          isLoading={isLoadingStarterPicks}
          isError={isErrorStarterPicks}
          onRetry={() => void refetchStarterPicks()}
        />
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 2. Continue where you left off (recently viewed)                    */}
      {/* Renders when recently viewed products exist, without layout flash.  */}
      {/* ------------------------------------------------------------------ */}
      {visibleRecent.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 animate-in fade-in duration-300">
          <TrendingCarousel
            title="Continue where you left off"
            eyebrow="Recently viewed"
            initialProducts={visibleRecent}
            recommendationSurface="HOME_RECENTLY_VIEWED"
            recommendationSessionId={sessionId}
          />
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 3. Picked for you                                                   */}
      {/* Renders when activity-based recommendations are available.          */}
      {/* ------------------------------------------------------------------ */}
      {visibleForYou.length >= MIN_PICKED_FOR_YOU_PRODUCTS && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 animate-in fade-in duration-300" aria-labelledby="for-you-heading">
          <TrendingCarousel
            title="Picked based on your activity"
            eyebrow="Personalized for you"
            headingId="for-you-heading"
            initialProducts={visibleForYou}
            recommendationSurface="HOME_FOR_YOU"
            recommendationSessionId={sessionId}
          />
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 4. Shop by interest — always visible (SSR data)                     */}
      {/* ------------------------------------------------------------------ */}
      <ShopByInterestSection categories={initialCategories} />

      {/* ------------------------------------------------------------------ */}
      {/* 5. New from vendors you follow (customers only)                     */}
      {/* Show skeleton while loading; omit once settled with no items.       */}
      {/* ------------------------------------------------------------------ */}
      {showFollowingSkeleton && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-busy="true" aria-label="New from followed vendors — loading">
          <TrendingSkeleton />
        </section>
      )}
      {followingSettled && visibleFollowing.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <TrendingCarousel
            title="New from vendors you follow"
            eyebrow="Your followed stores"
            initialProducts={visibleFollowing}
            recommendationSurface="HOME_FOLLOWING"
            recommendationSessionId={sessionId}
          />
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 6. Vendors to explore — shows skeleton until client stores resolve  */}
      {/* ------------------------------------------------------------------ */}
      {showStoresSkeleton && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-busy="true" aria-label="Vendors to explore — loading">
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Vendors to explore</h2>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="text-sm font-semibold text-muted-foreground">Explore all stores</span>
                <div className="flex items-center gap-1">
                  <div className="h-9 w-9 rounded-full bg-secondary animate-pulse" />
                  <div className="h-9 w-9 rounded-full bg-secondary animate-pulse" />
                </div>
              </div>
            </div>

            <div className="flex gap-4 overflow-hidden pb-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="w-[280px] sm:w-[320px] shrink-0 space-y-3 rounded-2xl border border-border/40 p-5 bg-card/60"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-secondary animate-pulse" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-4 w-3/4 rounded-md bg-secondary animate-pulse" />
                      <div className="h-3 w-1/2 rounded-md bg-secondary animate-pulse" />
                    </div>
                  </div>
                  <div className="h-10 w-full rounded-xl bg-secondary animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      {storesSettled && vendorsToExplore.length > 0 && (
        <VendorDiscoverySection
          vendors={vendorsToExplore}
          sessionId={sessionId}
          trackRecommendations={storesToDiscover.length > 0}
        />
      )}
      {storesSettled && isErrorStores && vendorsToExplore.length === 0 && (
        <section
          className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
          aria-label="Vendors to explore"
          role="status"
        >
          <div className="rounded-2xl border border-border bg-card/60 px-5 py-6">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Vendors to explore</h2>
            <p className="mt-1 text-sm text-muted-foreground">Vendors could not load just now.</p>
            <button
              type="button"
              onClick={() => void refetchStores()}
              className="mt-3 text-sm font-semibold text-foreground underline underline-offset-4"
            >
              Try again
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Global empty state — only shown when everything has settled empty   */}
      {/* ------------------------------------------------------------------ */}
      {!hasHomeContent && everythingSettled && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-live="polite">
          <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 text-center sm:px-10">
            <h2 className="text-xl font-semibold text-foreground">More to explore</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              Discover something different from independent stores across NUTS.
            </p>
            <Link
              href="/discover"
              className="mt-5 inline-flex rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-85"
            >
              Browse products
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

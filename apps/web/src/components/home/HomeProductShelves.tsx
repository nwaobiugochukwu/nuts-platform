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

const MIN_PICKED_FOR_YOU_PRODUCTS = 4;

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
  initialVendors,
  initialProducts,
}: {
  initialCategories: CategoryResponseDto[];
  initialVendors: FeaturedVendorDto[];
  /** SSR-prefetched trending products — displayed immediately on first paint
   *  as "A good place to start" before the personalized client query resolves. */
  initialProducts: ProductCardDto[];
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

  const visibleRecent = uniqueProducts(recentlyViewed, 12);
  const visibleStarterPicks = uniqueProducts(starterPicks, 12);
  const visibleForYou = uniqueProducts(
    forYou,
    12,
    new Set([...visibleRecent, ...visibleStarterPicks].map(({ id }) => id)),
  );
  const visibleFollowing = uniqueProducts(
    fromFollowedVendors,
    12,
    new Set([...visibleRecent, ...visibleStarterPicks, ...visibleForYou].map(({ id }) => id)),
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
  // We don't block rendering on this — SSR fallbacks are shown immediately.
  const clientHydrating = !isAuthInitialized || !sessionId;

  // "A good place to start": show SSR products immediately; replace with
  // personalized picks once they arrive. Never hide after first appearance.
  const displayedStarterPicks =
    visibleStarterPicks.length > 0 ? visibleStarterPicks : initialProducts;

  // Show a skeleton for "Continue where you left off" only while actively
  // loading. Once loaded with 0 items, omit the shelf entirely.
  const showRecentSkeleton = clientHydrating || isLoadingRecentlyViewed;
  const recentSettled = !clientHydrating && !isLoadingRecentlyViewed;

  // "Picked for you" follows the same pattern.
  const showForYouSkeleton = clientHydrating || isLoadingForYou;
  const forYouSettled = !clientHydrating && !isLoadingForYou;

  // "New from followed vendors" — customer-only shelf.
  const showFollowingSkeleton = isCustomer && (clientHydrating || isLoadingFollowing);
  const followingSettled = isCustomer && !clientHydrating && !isLoadingFollowing;

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
      {/* Always visible: starts with SSR trending products, upgrades to      */}
      {/* personalised starter picks once client queries resolve.             */}
      {/* ------------------------------------------------------------------ */}
      {(displayedStarterPicks.length > 0 || isErrorStarterPicks) && (
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
      {/* Show skeleton while loading; omit once settled with no items.       */}
      {/* ------------------------------------------------------------------ */}
      {showRecentSkeleton && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-busy="true" aria-label="Recently viewed — loading">
          <TrendingSkeleton />
        </section>
      )}
      {recentSettled && visibleRecent.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
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
      {/* Show skeleton while loading; omit once settled with < 4 items.     */}
      {/* ------------------------------------------------------------------ */}
      {showForYouSkeleton && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-busy="true" aria-label="Picked for you — loading" aria-labelledby="for-you-skeleton-heading">
          <TrendingSkeleton />
        </section>
      )}
      {forYouSettled && visibleForYou.length >= MIN_PICKED_FOR_YOU_PRODUCTS && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-labelledby="for-you-heading">
          <TrendingCarousel
            title="Picked for you"
            eyebrow="Based on your activity"
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
      {/* 6. Vendors to explore — SSR fallback available immediately          */}
      {/* ------------------------------------------------------------------ */}
      {vendorsToExplore.length > 0 ? (
        <VendorDiscoverySection
          vendors={vendorsToExplore}
          sessionId={sessionId}
          trackRecommendations={storesToDiscover.length > 0}
        />
      ) : isErrorStores ? (
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
      ) : null}

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

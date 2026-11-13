"use client";

import type { ProductCardDto } from "@/api/dto/product";
import type { FeaturedVendorDto } from "@/api/dto/vendor";
import type { CategoryResponseDto } from "@/api/dto/category";
import { TrendingCarousel } from "@/components/domain/product/TrendingCarousel";
import { GoodPlaceToStartSection } from "@/components/home/GoodPlaceToStartSection";
import { ShopByInterestSection } from "@/components/home/ShopByInterestSection";
import { VendorDiscoverySection } from "@/components/home/VendorDiscoverySection";
import Link from "@/components/navigation/AppLink";
import { usePersonalizedRecommendations } from "@/hooks/use-personalized-recommendations";

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
}: {
  initialCategories: CategoryResponseDto[];
  initialVendors: FeaturedVendorDto[];
}) {
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

  const waitingForSession = !sessionId;
  const waitingForIdentity = !isAuthInitialized;
  const recommendationsLoading = Boolean(
    waitingForIdentity || waitingForSession || isLoadingForYou ||
    isLoadingStarterPicks || isLoadingRecentlyViewed || isLoadingStores ||
    (isCustomer && isLoadingFollowing),
  );
  const hasHomeContent = Boolean(
    visibleStarterPicks.length || visibleRecent.length || visibleForYou.length ||
    visibleFollowing.length || initialCategories.length || vendorsToExplore.length,
  );

  return (
    <div className="space-y-14 pb-24 pt-8 sm:space-y-16">
      {(visibleStarterPicks.length > 0 || isErrorStarterPicks) && (
        <GoodPlaceToStartSection
          products={visibleStarterPicks}
          sessionId={sessionId}
          isLoading={isLoadingStarterPicks}
          isError={isErrorStarterPicks}
          onRetry={() => void refetchStarterPicks()}
        />
      )}

      {visibleRecent.length > 0 && (
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

      {visibleForYou.length >= MIN_PICKED_FOR_YOU_PRODUCTS && (
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

      <ShopByInterestSection categories={initialCategories} />

      {isCustomer && visibleFollowing.length > 0 && (
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

      {vendorsToExplore.length > 0 ? (
        <VendorDiscoverySection
          vendors={vendorsToExplore}
          sessionId={sessionId}
          trackRecommendations={storesToDiscover.length > 0}
        />
      ) : isErrorStores ? (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-label="Vendors to explore" role="status">
          <div className="rounded-2xl border border-border bg-card/60 px-5 py-6">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Vendors to explore</h2>
            <p className="mt-1 text-sm text-muted-foreground">Vendors could not load just now.</p>
            <button type="button" onClick={() => void refetchStores()} className="mt-3 text-sm font-semibold text-foreground underline underline-offset-4">Try again</button>
          </div>
        </section>
      ) : null}

      {!hasHomeContent && !recommendationsLoading && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-live="polite">
          <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 text-center sm:px-10">
            <h2 className="text-xl font-semibold text-foreground">More to explore</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              Discover something different from independent stores across NUTS.
            </p>
            <Link href="/discover" className="mt-5 inline-flex rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-85">
              Browse products
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

"use client";

import type { FeaturedVendorDto } from "@/api/dto/vendor";
import { analyticsEventService, type RecommendationAttribution } from "@/api/modules/analytics";
import { RemoteImage } from "@/component/ui/RemoteImage";
import Link from "@/components/navigation/AppLink";
import { useVendorFollowing } from "@/hooks/use-vendor-following";
import { useAuthStore } from "@/zustand/auth";
import { useRouter } from "next/navigation";
import { storeRecommendationAttribution } from "@/lib/recommendation-attribution";
import { createRecommendationRequestId } from "@/lib/recommendation-session";
import { useRecommendationImpression } from "@/hooks/use-recommendation-impression";
import { BadgeCheck, ChevronLeft, ChevronRight, Store } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const RANKER_VERSION = "hybrid-v2";

interface VendorDiscoverySectionProps {
  vendors: FeaturedVendorDto[];
  sessionId: string;
  trackRecommendations?: boolean;
}

export function VendorDiscoverySection({ vendors, sessionId, trackRecommendations = true }: VendorDiscoverySectionProps) {
  const router = useRouter();
  const vendorScrollRef = useRef<HTMLDivElement>(null);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const canPurchase = useAuthStore((state) => state.capabilities?.canPurchase ?? false);
  const isCustomer = isAuthenticated && canPurchase;
  const canTrackRecommendations = !isAuthenticated || isCustomer;
  const [requestId, setRequestId] = useState("");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setRequestId(createRecommendationRequestId());
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const { followedIds, isLoading: isLoadingFollows, isPending, setFollowing } = useVendorFollowing();

  const scrollVendors = (direction: "left" | "right") => {
    const container = vendorScrollRef.current;
    if (!container) return;
    const distance = Math.max(280, container.clientWidth * 0.85);
    container.scrollBy({
      left: direction === "left" ? -distance : distance,
      behavior: "smooth",
    });
  };

  const attributions = useMemo(
    () => vendors.map((_, position): RecommendationAttribution | undefined =>
      trackRecommendations && requestId && sessionId && canTrackRecommendations
        ? { requestId, surface: "HOME_MEET_VENDORS", rankerVersion: RANKER_VERSION, position, sessionId }
        : undefined,
    ),
    [canTrackRecommendations, requestId, sessionId, trackRecommendations, vendors],
  );

  if (vendors.length === 0) return null;

  const handleFollow = async (vendor: FeaturedVendorDto) => {
    if (!isAuthenticated) {
      router.push(`/auth/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (!isCustomer) return;
    const following = !followedIds.has(vendor.id);
    try {
      await setFollowing(vendor, following);
      toast.success(following ? `Following ${vendor.storeName}` : `Unfollowed ${vendor.storeName}`);
    } catch {
      toast.error(`Could not ${following ? "follow" : "unfollow"} this store. Please try again.`);
    }
  };

  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8" aria-labelledby="vendors-to-explore-heading">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="vendors-to-explore-heading" className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Vendors to explore</h2>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <Link href="/vendor" className="text-sm font-semibold text-foreground underline-offset-4 hover:underline">Explore all stores</Link>
          {vendors.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => scrollVendors("left")}
                aria-label="Previous vendors"
                aria-controls="featured-vendors-scroll"
                className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollVendors("right")}
                aria-label="Next vendors"
                aria-controls="featured-vendors-scroll"
                className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div
        id="featured-vendors-scroll"
        ref={vendorScrollRef}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Featured vendors"
      >
        {vendors.map((vendor, position) => (
          <div key={vendor.id} className="w-[min(86vw,380px)] shrink-0 snap-start sm:w-[340px]">
            <VendorFeatureCard
              vendor={vendor}
              isFollowing={followedIds.has(vendor.id)}
              isLoadingFollows={isLoadingFollows}
              isCustomer={isCustomer}
              isAuthenticated={isAuthenticated}
              isPending={isPending(vendor.id)}
              attribution={attributions[position]}
              onFollow={() => void handleFollow(vendor)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function VendorFeatureCard({
  vendor,
  isFollowing,
  isLoadingFollows,
  isCustomer,
  isAuthenticated,
  isPending,
  attribution,
  onFollow,
}: {
  vendor: FeaturedVendorDto;
  isFollowing: boolean;
  isLoadingFollows: boolean;
  isCustomer: boolean;
  isAuthenticated: boolean;
  isPending: boolean;
  attribution?: RecommendationAttribution;
  onFollow: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  useRecommendationImpression({
    elementRef: cardRef,
    attribution,
    item: { vendorId: vendor.id },
    authenticated: isCustomer,
  });

  const trackClick = () => {
    if (!attribution) return;
    void analyticsEventService.trackRecommendation(attribution, "CLICK", { vendorId: vendor.id }, isCustomer).catch(() => undefined);
  };

  const trackProductClick = (productId: string) => {
    if (!attribution) return;
    storeRecommendationAttribution(productId, attribution);
    void analyticsEventService.trackRecommendation(
      attribution,
      "CLICK",
      { productId, vendorId: vendor.id },
      isCustomer,
    ).catch(() => undefined);
  };

  return (
    <article ref={cardRef} className="flex h-full flex-col rounded-2xl border border-border bg-card p-4 shadow-xs sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl text-muted-foreground">
          {vendor.storeLogoUrl
            ? <RemoteImage src={vendor.storeLogoUrl} alt={`${vendor.storeName} logo`} className="h-full w-full object-cover" />
            : <Store className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <Link href={`/vendor/${encodeURIComponent(vendor.storeSlug)}`} onClick={trackClick} className="inline-flex max-w-full items-center gap-1 text-base font-semibold text-foreground hover:underline">
            <span className="truncate">{vendor.storeName}</span>
            {vendor.isVerified && <BadgeCheck aria-label="Verified store" className="h-4 w-4 shrink-0 text-primary" />}
          </Link>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">{vendor.storeDescription || "Browse this store’s available products."}</p>
        </div>
      </div>

      {vendor.featuredProducts.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3">
          {vendor.featuredProducts.slice(0, 2).map((product) => (
            <Link
              key={product.id}
              href={`/product/${encodeURIComponent(product.slug)}`}
              onClick={() => trackProductClick(product.id)}
              className="min-w-0 rounded-xl transition-colors"
            >
              <div className="mb-2 flex aspect-square items-center justify-center overflow-hidden rounded-lg text-muted-foreground">
                {product.thumbnail ? (
                  <RemoteImage
                    src={product.thumbnail}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Store className="h-6 w-6" aria-hidden="true" />
                )}
              </div>
              <span className="block truncate text-xs font-medium text-foreground">
                {product.name}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <Link href={`/vendor/${encodeURIComponent(vendor.storeSlug)}`} onClick={trackClick} className="text-sm font-semibold text-foreground underline-offset-4 hover:underline">Visit store</Link>
        {isCustomer && (
          <button type="button" onClick={onFollow} disabled={isLoadingFollows || isPending} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50">
            {isLoadingFollows
              ? "Checking…"
              : isPending
                ? (isFollowing ? "Following…" : "Unfollowing…")
                : isFollowing ? "Following" : "Follow store"}
          </button>
        )}
        {!isAuthenticated && (
          <button type="button" onClick={onFollow} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary">Follow store</button>
        )}
      </div>
    </article>
  );
}

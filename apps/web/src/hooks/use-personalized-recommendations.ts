"use client";

import { recommendationService } from "@/api/modules/recommendations";
import { useAuthStore } from "@/zustand/auth";
import { useQuery } from "@tanstack/react-query";
import {
  useRecommendationSessionId,
  useRecommendationVisitorId,
} from "@/hooks/use-recommendation-session";
import type { ProductCardDto } from "@/api/dto/product";
import type { MarketplaceMixVendorDto } from "@/api/dto/recommendations";
import { useMemo } from "react";

const STARTER_PICK_LIMIT = 12;

function selectStarterPicks(
  personalized: ProductCardDto[],
  rotatingVendors: MarketplaceMixVendorDto[],
): ProductCardDto[] {
  const selected: ProductCardDto[] = [];
  const selectedProductIds = new Set<string>();
  const selectedVendorIds = new Set<string>();

  const add = (product: ProductCardDto) => {
    const vendorId = product.vendor?.id;
    if (
      !vendorId ||
      !product.thumbnail ||
      selectedProductIds.has(product.id) ||
      selectedVendorIds.has(vendorId) ||
      selected.length >= STARTER_PICK_LIMIT
    ) return;
    selected.push(product);
    selectedProductIds.add(product.id);
    selectedVendorIds.add(vendorId);
  };

  // 1. Prioritize rotating marketplace mix (one in-stock product per unique vendor)
  for (const vendor of rotatingVendors) {
    if (selected.length >= STARTER_PICK_LIMIT) break;
    const product = vendor.products.find((candidate) => !selectedProductIds.has(candidate.id));
    if (product) add(product);
  }

  // 2. If slots remain, supplement with relevant activity-based picks
  for (const product of personalized) {
    if (selected.length >= STARTER_PICK_LIMIT) break;
    add(product);
  }

  return selected;
}

export function useForYouRecommendations(enabled = true) {
  const userId = useAuthStore((state) => state.user?.id);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAuthInitialized = useAuthStore((state) => state.isInitialized);
  const canPurchase = useAuthStore((state) => state.capabilities?.canPurchase ?? false);
  const isCustomer = isAuthenticated && canPurchase;
  const isShopper = !isAuthenticated || isCustomer;
  const sessionId = useRecommendationSessionId();
  const visitorId = useRecommendationVisitorId();

  const requestEnabled = enabled && isAuthInitialized && isShopper && Boolean(sessionId);
  const query = useQuery({
    queryKey: ["recommendations", "for-you", userId ?? null, sessionId, visitorId],
    queryFn: async () =>
      (await recommendationService.forYou(sessionId, isCustomer, visitorId)).data,
    enabled: requestEnabled,
    staleTime: 120_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return {
    ...query,
    products: query.data ?? [],
    sessionId,
    visitorId,
    userId,
    isAuthInitialized,
    isCustomer,
    isShopper,
  };
}

export function usePersonalizedRecommendations(enabled = true) {
  const forYouQuery = useForYouRecommendations(enabled);
  const {
    userId,
    isAuthInitialized,
    isCustomer,
    isShopper,
    sessionId,
    visitorId,
  } = forYouQuery;
  const requestEnabled =
    enabled && isAuthInitialized && isShopper && Boolean(sessionId);
  const publicDiscoveryEnabled =
    enabled && isAuthInitialized && Boolean(sessionId);
  const recentQuery = useQuery({
    queryKey: ["recommendations", "recently-viewed", userId ?? null, sessionId, visitorId],
    queryFn: async () => (await recommendationService.recentlyViewed(sessionId, isCustomer, visitorId)).data,
    enabled: requestEnabled,
    staleTime: 120_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const followingQuery = useQuery({
    queryKey: ["recommendations", "following", userId],
    queryFn: async () => (await recommendationService.following()).data,
    enabled: enabled && isCustomer,
    staleTime: 120_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const storesQuery = useQuery({
    queryKey: ["recommendations", "stores", userId ?? null, sessionId, visitorId],
    queryFn: async () =>
      (await recommendationService.stores(sessionId, isCustomer, visitorId)).data,
    // Store discovery is a separate shelf and must not wait for For You or the
    // cold-start store mix to finish.
    enabled: publicDiscoveryEnabled,
    staleTime: 120_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const marketplaceMixQuery = useQuery({
    queryKey: ["recommendations", "marketplace-mix", userId ?? null, sessionId, visitorId],
    queryFn: async () =>
      (await recommendationService.marketplaceMix(sessionId, isCustomer, visitorId)).data,
    enabled: publicDiscoveryEnabled,
    staleTime: 120_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const starterPicks = useMemo(
    () => selectStarterPicks(forYouQuery.products, marketplaceMixQuery.data?.vendors ?? []),
    [forYouQuery.products, marketplaceMixQuery.data?.vendors],
  );

  return {
    ...forYouQuery,
    starterPicks,
    isLoadingStarterPicks: marketplaceMixQuery.isLoading || (isShopper && forYouQuery.isLoading),
    isErrorStarterPicks: marketplaceMixQuery.isError && !forYouQuery.isLoading && starterPicks.length === 0,
    refetchStarterPicks: marketplaceMixQuery.refetch,
    storesToDiscover: storesQuery.data ?? [],
    isLoadingStores: storesQuery.isLoading,
    isFetchingStores: storesQuery.isFetching,
    isSuccessStores: storesQuery.isSuccess,
    isErrorStores: storesQuery.isError,
    refetchStores: storesQuery.refetch,
    recentlyViewed: recentQuery.data ?? [],
    fromFollowedVendors: followingQuery.data ?? [],
    sessionId,
    visitorId,
    isAuthInitialized,
    isCustomer,
    isShopper,
    isLoadingRecentlyViewed: recentQuery.isLoading,
    isLoadingFollowing: followingQuery.isLoading,
  };
}

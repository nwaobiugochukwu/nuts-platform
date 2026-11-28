"use client";

import { recommendationService } from "@/api/services/recommendations";
import { queryKey } from "@/lib/query-key";
import { useAuthStore } from "@/zustand/auth";
import { useQuery } from "@tanstack/react-query";
import {
  useRecommendationSessionId,
  useRecommendationVisitorId,
} from "@/hooks/use-recommendation-session";
import { useMemo } from "react";

/**
 * How long a personalised shelf counts as fresh. Every shelf here refetches when the browser window
 * regains focus and its data is stale; with the old 30 s to 2 min windows, each alt-tab (or
 * devtools focus change) after a minute re-sent every shelf, which looked like duplicate requests.
 * Behavioural signals still mark the shelves stale (see refreshPersonalizedRecommendations), so
 * they refresh the next time they are shown; this window only covers "came back later".
 */
const SHELF_STALE_MS = 5 * 60_000;

export function useForYouRecommendations(enabled = true) {
  const userId = useAuthStore((state) => state.user?.id);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAuthInitialized = useAuthStore((state) => state.isInitialized);
  const canPurchase = useAuthStore((state) => state.capabilities?.canPurchase ?? false);
  const isCustomer = isAuthenticated && canPurchase;
  const isShopper = true;
  const sessionId = useRecommendationSessionId();
  const visitorId = useRecommendationVisitorId();

  const requestEnabled = enabled && isAuthInitialized && isShopper && Boolean(sessionId);
  const query = useQuery({
    queryKey: queryKey.recommendations.forYou(userId, sessionId, visitorId),
    queryFn: async ({ signal }) =>
      (await recommendationService.forYou(sessionId, isCustomer, visitorId, signal)).data,
    // Keep the previous result on screen while a refresh is in flight so the
    // shelf never blanks out and pops back in (same user only).
    // queryKey[2] is the user id: never show a previous identity's picks.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === (userId ?? null) ? previous : undefined,
    enabled: requestEnabled,
    // Freshness after the shopper DOES something comes from explicit
    // invalidation (see refreshPersonalizedRecommendations), not from this
    // timer. The timer only covers "came back to the tab a while later", so it
    // must be long enough that merely focusing the window never re-sends
    // requests that are still current.
    staleTime: SHELF_STALE_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
    queryKey: queryKey.recommendations.recentlyViewed(userId, sessionId, visitorId),
    queryFn: async ({ signal }) => (await recommendationService.recentlyViewed(sessionId, isCustomer, visitorId, signal)).data,
    // Keep the previous result on screen while a refresh is in flight so the
    // shelf never blanks out and pops back in (same user only).
    // queryKey[2] is the user id: never show a previous identity's picks.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === (userId ?? null) ? previous : undefined,
    enabled: requestEnabled,
    // Recently viewed should be fresh — 30s so returning to home picks up
    // any new views from product pages visited in the same session.
    staleTime: SHELF_STALE_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const followingQuery = useQuery({
    queryKey: queryKey.recommendations.following(userId),
    queryFn: async ({ signal }) => (await recommendationService.following(signal)).data,
    enabled: enabled && isCustomer,
    // Never blank the shelf while a refetch (or auth refresh) is in flight.
    // queryKey[2] is the user id: never show a previous identity's picks.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === (userId ?? null) ? previous : undefined,
    staleTime: SHELF_STALE_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const storesQuery = useQuery({
    queryKey: queryKey.recommendations.stores(userId, sessionId, visitorId),
    queryFn: async ({ signal }) =>
      (await recommendationService.stores(sessionId, isCustomer, visitorId, signal)).data,
    // Store discovery is a separate shelf and must not wait for For You or the
    // cold-start store mix to finish.
    // Keep the previous result on screen while a refresh is in flight so the
    // shelf never blanks out and pops back in (same user only).
    // queryKey[2] is the user id: never show a previous identity's picks.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === (userId ?? null) ? previous : undefined,
    enabled: publicDiscoveryEnabled,
    staleTime: SHELF_STALE_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // The first shelf is built on the server in one request: a daily spread across stores, topped
  // up with picks for this shopper. (It used to be assembled here from two requests.)
  const goodPlaceToStartQuery = useQuery({
    queryKey: queryKey.recommendations.goodPlaceToStart(userId, sessionId, visitorId),
    queryFn: async ({ signal }) =>
      (await recommendationService.goodPlaceToStart(sessionId, isCustomer, visitorId, signal)).data,
    // Keep the previous result on screen while a refresh is in flight so the
    // shelf never blanks out and pops back in (same user only).
    // queryKey[2] is the user id: never show a previous identity's picks.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === (userId ?? null) ? previous : undefined,
    enabled: publicDiscoveryEnabled,
    staleTime: SHELF_STALE_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const goodPlaceToStart = useMemo(
    () => (goodPlaceToStartQuery.data?.items ?? []).map((item) => item.product),
    [goodPlaceToStartQuery.data],
  );

  return {
    ...forYouQuery,
    goodPlaceToStart,
    isLoadingGoodPlaceToStart: goodPlaceToStartQuery.isLoading,
    isErrorGoodPlaceToStart: goodPlaceToStartQuery.isError && goodPlaceToStart.length === 0,
    refetchGoodPlaceToStart: goodPlaceToStartQuery.refetch,
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

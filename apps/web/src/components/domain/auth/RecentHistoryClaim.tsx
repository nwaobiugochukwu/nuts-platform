"use client";

import { recommendationService } from "@/api/modules/recommendations";
import { queryKey } from "@/lib/query-key";
import { useRecommendationVisitorId } from "@/hooks/use-recommendation-session";
import { useAuthStore } from "@/zustand/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export function RecentHistoryClaim() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);
  const isCustomer = useAuthStore((state) =>
    state.isAuthenticated && (state.capabilities?.canPurchase ?? false),
  );
  const visitorId = useRecommendationVisitorId();

  const claimQuery = useQuery({
    queryKey: queryKey.recommendations.recentHistoryClaim(userId, undefined, visitorId),
    queryFn: async () => (await recommendationService.claimRecentlyViewed(visitorId)).data,
    enabled: isCustomer && Boolean(userId && visitorId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    // Only refresh the shelves when guest history was actually merged into the
    // account. Refreshing unconditionally re-fetched three shelves on every
    // page load, racing the initial requests for no new data.
    if (claimQuery.isSuccess && userId && (claimQuery.data?.claimed ?? 0) > 0) {
      const options = { cancelRefetch: false } as const;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKey.recommendations.forYou(userId), refetchType: "active" }, options),
        queryClient.invalidateQueries({ queryKey: queryKey.recommendations.recentlyViewed(userId), refetchType: "active" }, options),
        queryClient.invalidateQueries({ queryKey: queryKey.recommendations.stores(userId), refetchType: "active" }, options),
      ]);
    }
  }, [claimQuery.isSuccess, claimQuery.data?.claimed, queryClient, userId]);

  return null;
}

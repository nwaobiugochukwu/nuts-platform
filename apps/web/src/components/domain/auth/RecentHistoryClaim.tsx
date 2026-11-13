"use client";

import { recommendationService } from "@/api/modules/recommendations";
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
    queryKey: ["recommendations", "recent-history-claim", userId ?? null, visitorId],
    queryFn: async () => (await recommendationService.claimRecentlyViewed(visitorId)).data,
    enabled: isCustomer && Boolean(userId && visitorId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (claimQuery.isSuccess && userId) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recommendations", "for-you", userId], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["recommendations", "recently-viewed", userId], refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: ["recommendations", "stores", userId], refetchType: "all" }),
      ]);
    }
  }, [claimQuery.isSuccess, queryClient, userId]);

  return null;
}

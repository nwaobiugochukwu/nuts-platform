"use client";

import { recommendationService } from "@/api/modules/recommendations";
import { queryKey } from "@/lib/query-key";
import { useRecommendationVisitorId } from "@/hooks/use-recommendation-session";
import { useAuthStore } from "@/zustand/auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const CLAIM_MARKER_PREFIX = "nuts.history-claimed.v1:";

function markerFor(userId: string, visitorId: string): string {
  return `${CLAIM_MARKER_PREFIX}${userId}:${visitorId}`;
}

function wasClaimed(userId: string, visitorId: string): boolean {
  try {
    return window.localStorage.getItem(markerFor(userId, visitorId)) === "1";
  } catch {
    return false;
  }
}

function rememberClaimed(userId: string, visitorId: string): void {
  try {
    window.localStorage.setItem(markerFor(userId, visitorId), "1");
  } catch {
    // Storage blocked: the server-side claim is idempotent, so a repeat is safe.
  }
}

/**
 * Merges what this browser viewed as a guest into the account that just signed
 * in. It is a one-time action per (account, browser identity), so it is a
 * mutation guarded by a persisted marker, NOT a query: a query would be
 * re-run by cache invalidation and refocus, re-posting on every navigation.
 *
 * (The recommendation endpoints also read guest rows live for signed-in users,
 * so this mainly makes the merge durable for later sessions and other devices.)
 */
export function RecentHistoryClaim() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);
  const isCustomer = useAuthStore((state) =>
    state.isAuthenticated && (state.capabilities?.canPurchase ?? false),
  );
  const visitorId = useRecommendationVisitorId();
  const attempted = useRef<string>("");

  const claim = useMutation({
    mutationFn: async (variables: { userId: string; visitorId: string }) =>
      (await recommendationService.claimRecentlyViewed(variables.visitorId)).data,
    onSuccess: (result, variables) => {
      rememberClaimed(variables.userId, variables.visitorId);
      // Refresh on-screen shelves only if the merge actually changed history,
      // and never restart a request that is already loading.
      if ((result?.claimed ?? 0) > 0) {
        const options = { cancelRefetch: false } as const;
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKey.recommendations.forYou(variables.userId), refetchType: "active" }, options),
          queryClient.invalidateQueries({ queryKey: queryKey.recommendations.recentlyViewed(variables.userId), refetchType: "active" }, options),
          queryClient.invalidateQueries({ queryKey: queryKey.recommendations.stores(variables.userId), refetchType: "active" }, options),
        ]);
      }
    },
  });

  useEffect(() => {
    if (!isCustomer || !userId || !visitorId) return;
    const pair = `${userId}:${visitorId}`;
    // One attempt per pair per page load (also guards React StrictMode), and
    // none at all if a previous visit already claimed this pair.
    if (attempted.current === pair || wasClaimed(userId, visitorId)) return;
    attempted.current = pair;
    claim.mutate({ userId, visitorId });
  }, [isCustomer, userId, visitorId, claim]);

  return null;
}

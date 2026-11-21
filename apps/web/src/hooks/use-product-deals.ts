"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  publicDiscountService,
  type BatchProductDealsResult,
} from "@/api/modules/public-discounts";
import { useAuthStore } from "@/zustand/auth";
import { queryKey } from "@/lib/query-key";

/**
 * Hook to retrieve site-wide promotional campaigns for the header ticker.
 */
export function usePlatformPromos() {
  const { isAuthenticated, isInitialized, user } = useAuthStore();
  const shopperKey = isAuthenticated ? user?.id ?? "authenticated" : "guest";

  return useQuery({
    queryKey: queryKey.discounts.platformPromos(shopperKey),
    queryFn: async () => {
      const res = await publicDiscountService.getPlatformPromos(isAuthenticated);
      return res.data;
    },
    enabled: isInitialized,
    staleTime: 120_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch discount intelligence and all available vouchers for a specific product.
 */
export function useProductDeal(productId?: string) {
  const { isAuthenticated, isInitialized, user } = useAuthStore();
  const shopperKey = isAuthenticated ? user?.id ?? "authenticated" : "guest";

  return useQuery({
    queryKey: queryKey.discounts.forProduct(productId ?? "", shopperKey),
    queryFn: async () => {
      if (!productId) throw new Error("productId is required");
      const res = await publicDiscountService.getProductDeals(
        productId,
        isAuthenticated,
      );
      return res.data;
    },
    enabled: Boolean(productId && isInitialized),
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to batch fetch best deal for multiple products at once (e.g., catalog shelves).
 */
export function useBatchProductDeals(productIds: string[]) {
  const { isAuthenticated, isInitialized, user } = useAuthStore();
  const shopperKey = isAuthenticated ? user?.id ?? "authenticated" : "guest";
  const normalizedIds = useMemo(() => {
    return Array.from(new Set(productIds.filter(Boolean))).sort();
  }, [productIds]);

  const batchKey = normalizedIds.join(",");

  return useQuery({
    queryKey: queryKey.discounts.batch(batchKey, shopperKey),
    queryFn: async (): Promise<BatchProductDealsResult> => {
      if (normalizedIds.length === 0) return {};
      return publicDiscountService.getBatchProductDeals(
        normalizedIds,
        isAuthenticated,
        shopperKey,
      );
    },
    enabled: normalizedIds.length > 0 && isInitialized,
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

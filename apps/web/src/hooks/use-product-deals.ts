"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { publicDiscountService } from "@/api/modules/public-discounts";
import { orderService } from "@/api/modules/order";
import { useAuthStore } from "@/zustand/auth";
import { queryKey } from "@/lib/query-key";

/**
 * Hook to retrieve site-wide promotional campaigns for the header ticker.
 */
export function usePlatformPromos() {
  return useQuery({
    queryKey: queryKey.discounts.platformPromos,
    queryFn: async ({ signal }) => {
      const res = await publicDiscountService.getPlatformPromos(signal);
      return res.data;
    },
    staleTime: 120_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to determine if the current shopper has never bought any single item before.
 * - Unauthenticated (guest): Considered a first-time shopper (isFirstTime = true).
 * - Authenticated: Queries order history. If total orders > 0, hasPurchased = true.
 */
export function useFirstTimeShopper() {
  const { isAuthenticated, isInitialized } = useAuthStore();

  const { data: ordersResponse, isLoading } = useQuery({
    queryKey: queryKey.order.list({ page: 1, limit: 1 }),
    queryFn: async () => {
      const res = await orderService.list({ page: 1, limit: 1 });
      return res;
    },
    enabled: Boolean(isAuthenticated && isInitialized),
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });

  if (!isAuthenticated) {
    return {
      isFirstTime: true,
      hasPurchased: false,
      isLoading: false,
    };
  }

  if (isLoading) {
    return {
      isFirstTime: false,
      hasPurchased: false,
      isLoading: true,
    };
  }

  const orders = ordersResponse?.data ?? [];
  const meta = ordersResponse?.meta;
  const totalOrders =
    meta && typeof meta === "object" && "total" in meta
      ? Number(meta.total)
      : orders.length;

  const hasPurchased = totalOrders > 0;

  return {
    isFirstTime: !hasPurchased,
    hasPurchased,
    isLoading: false,
  };
}

/**
 * Hook to fetch discount intelligence and all available vouchers for a specific product.
 */
export function useProductDeal(productId?: string) {
  return useQuery({
    queryKey: queryKey.discounts.forProduct(productId ?? ""),
    queryFn: async ({ signal }) => {
      if (!productId) throw new Error("productId is required");
      const res = await publicDiscountService.getProductDeals(productId, signal);
      return res.data;
    },
    enabled: Boolean(productId),
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to batch fetch best deal for multiple products at once (e.g., catalog shelves).
 */
export function useBatchProductDeals(productIds: string[]) {
  const normalizedIds = useMemo(() => {
    return Array.from(new Set(productIds.filter(Boolean))).sort();
  }, [productIds]);

  const batchKey = normalizedIds.join(",");

  return useQuery({
    queryKey: queryKey.discounts.batch(batchKey),
    queryFn: async ({ signal }) => {
      if (normalizedIds.length === 0) return {};
      const res = await publicDiscountService.getBatchProductDeals(normalizedIds, signal);
      return res.data;
    },
    enabled: normalizedIds.length > 0,
    staleTime: 60_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  publicDiscountService,
  type BatchProductDealsResult,
} from "@/api/modules/public-discounts";
import type {
  PublicPlatformPromoDto,
  PublicProductDealDto,
} from "@/api/dto/discount";
import { useAuthStore } from "@/zustand/auth";
import { queryKey } from "@/lib/query-key";

/**
 * Hook to retrieve site-wide promotional campaigns for the header ticker.
 */
export function usePlatformPromos(initialPromos?: PublicPlatformPromoDto[]) {
  return useQuery({
    queryKey: queryKey.discounts.platformPromos,
    queryFn: async () => {
      const res = await publicDiscountService.getPlatformPromos(false);
      const raw = res.data;
      if (Array.isArray(raw)) return raw;
      if (
        raw &&
        typeof raw === "object" &&
        "data" in raw &&
        Array.isArray((raw as { data: unknown }).data)
      ) {
        return (raw as { data: PublicPlatformPromoDto[] }).data;
      }
      return [];
    },
    initialData: initialPromos && initialPromos.length > 0 ? initialPromos : undefined,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
}

/**
 * Hook to fetch discount intelligence and all available vouchers for a specific product.
 */
export function useProductDeal(productId?: string) {
  const { isAuthenticated } = useAuthStore();

  return useQuery({
    queryKey: queryKey.discounts.forProduct(productId ?? ""),
    queryFn: async () => {
      if (!productId) throw new Error("productId is required");
      const res = await publicDiscountService.getProductDeals(
        productId,
        isAuthenticated,
      );
      const raw = res.data;
      return (
        raw && typeof raw === "object" && "data" in raw
          ? (raw as { data: PublicProductDealDto }).data
          : raw
      ) as PublicProductDealDto;
    },
    enabled: Boolean(productId),
    staleTime: 180_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to batch fetch best deal for multiple products at once (e.g., catalog shelves).
 */
export function useBatchProductDeals(productIds: string[]) {
  const { isAuthenticated } = useAuthStore();
  const normalizedIds = useMemo(() => {
    return Array.from(new Set(productIds.filter(Boolean))).sort();
  }, [productIds]);

  const batchKey = normalizedIds.join(",");

  return useQuery({
    queryKey: queryKey.discounts.batch(batchKey),
    queryFn: async (): Promise<BatchProductDealsResult> => {
      if (normalizedIds.length === 0) return {};
      return publicDiscountService.getBatchProductDeals(
        normalizedIds,
        isAuthenticated,
      );
    },
    enabled: normalizedIds.length > 0,
    staleTime: 180_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  publicDiscountService,
  type BatchProductDealsResult,
} from "@/api/services/public-discounts";
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
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const userId = useAuthStore((state) => state.user?.id);

  // Who is looking decides which campaigns are shown: "first order only" offers
  // must never reach a returning customer. The server-rendered list is fetched
  // anonymously, so it is only trusted for a confirmed guest; for a signed-in
  // customer the server filters by their order history.
  const viewer = !isInitialized ? "pending" : isAuthenticated ? (userId ?? "user") : "guest";
  const isGuest = viewer === "guest";
  const safeInitial = initialPromos?.filter((promo) => !promo.isFirstOrderOnly);

  return useQuery({
    queryKey: [...queryKey.discounts.platformPromos, viewer] as const,
    enabled: isInitialized,
    queryFn: async () => {
      const parse = (raw: unknown): PublicPlatformPromoDto[] => {
        if (Array.isArray(raw)) return raw as PublicPlatformPromoDto[];
        if (
          raw &&
          typeof raw === "object" &&
          "data" in raw &&
          Array.isArray((raw as { data: unknown }).data)
        ) {
          return (raw as { data: PublicPlatformPromoDto[] }).data;
        }
        // An unrecognised body is an error, not "no campaigns": returning [] here
        // would wipe a good banner after a hiccup.
        throw new Error("Unexpected campaigns response");
      };

      if (isAuthenticated) {
        try {
          return parse((await publicDiscountService.getPlatformPromos(true)).data);
        } catch {
          // Session refresh or transient failure: fall back to the public list, minus
          // offers reserved for first-time shoppers (we cannot verify this viewer).
          const list = parse((await publicDiscountService.getPlatformPromos(false)).data);
          return list.filter((promo) => !promo.isFirstOrderOnly);
        }
      }
      return parse((await publicDiscountService.getPlatformPromos(false)).data);
    },
    // Guests can use the SSR list as-is. Everyone else sees only the offers that
    // are safe for any viewer until their own list arrives.
    initialData: isGuest && initialPromos && initialPromos.length > 0 ? initialPromos : undefined,
    placeholderData: isGuest ? undefined : safeInitial,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    retry: 1,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
    // The key is the exact set of ids on screen, so dismissing or swapping one
    // product changes it. Keep showing the previous deals (looked up per product
    // id) until the new batch arrives, so the other cards' campaign tags do not
    // vanish and reappear.
    placeholderData: keepPreviousData,
    staleTime: 180_000,
    gcTime: 300_000,
    // The service already coalesces + caches per product; never re-POST on
    // mount/reconnect/failure (react-query's default 3 retries multiplied calls).
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

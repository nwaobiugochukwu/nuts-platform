"use client";

import type { CategoryResponseDto } from "@/api/dto/category";
import { categoryService } from "@/api/modules/category";
import { queryKey } from "@/lib/query-key";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

// Persistent module-level cache: categories are a static taxonomy that never needs re-fetching within a session
let memoryCachedCategories: CategoryResponseDto[] | null = null;

export function usePublicCategories(
  initialCategories?: CategoryResponseDto[],
  enabled = true,
) {
  const queryClient = useQueryClient();
  const hasInitial = Boolean(initialCategories && initialCategories.length > 0);

  useEffect(() => {
    if (hasInitial && initialCategories) {
      memoryCachedCategories = initialCategories;
      queryClient.setQueryData(queryKey.category.list(), initialCategories);
    }
  }, [hasInitial, initialCategories, queryClient]);

  const existingCache =
    (hasInitial ? initialCategories : undefined) ??
    memoryCachedCategories ??
    queryClient.getQueryData<CategoryResponseDto[]>(queryKey.category.list());

  const hasAnyCached = Boolean(existingCache && existingCache.length > 0);

  return useQuery({
    queryKey: queryKey.category.list(),
    queryFn: async () => {
      if (memoryCachedCategories && memoryCachedCategories.length > 0) {
        return memoryCachedCategories;
      }
      const existing = queryClient.getQueryData<CategoryResponseDto[]>(
        queryKey.category.list(),
      );
      if (existing && existing.length > 0) {
        memoryCachedCategories = existing;
        return existing;
      }
      const { data } = await categoryService.getAll();
      const list = Array.isArray(data) ? data : [];
      if (list.length > 0) {
        memoryCachedCategories = list;
      }
      return list;
    },
    initialData: hasAnyCached ? existingCache : undefined,
    initialDataUpdatedAt: hasAnyCached ? () => Date.now() : undefined,
    enabled: enabled && !hasAnyCached,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

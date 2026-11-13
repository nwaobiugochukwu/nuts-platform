import { serverFetch } from "@/api/core/server-fetcher";
import type { CategoryResponseDto } from "@/api/dto/category";
import { cache } from "react";

/**
 * Server-side public categories fetch.
 * Cached with 1 hour revalidation and per-request memoization.
 */
export const serverGetCategories = cache(async function serverGetCategories(): Promise<CategoryResponseDto[]> {
  const data = await serverFetch<CategoryResponseDto[]>("/categories", {
    revalidate: 3600,
    tags: ["categories"],
  });
  return Array.isArray(data) ? data : [];
});

/**
 * Server-side category lookup by path.
 */
export const serverGetCategoryByPath = cache(async function serverGetCategoryByPath(
  path: string
): Promise<CategoryResponseDto | null> {
  if (!path) return null;
  return serverFetch<CategoryResponseDto>(`/categories/path/${path}`, {
    revalidate: 1800,
    tags: ["categories", `category:path:${path}`],
  });
});

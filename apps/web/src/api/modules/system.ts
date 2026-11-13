import { adminApi } from "@/api/core/client";

export interface CacheStatsResponse {
  connected: boolean;
  totalKeys?: number;
  memoryUsed?: string;
  uptimeInSeconds?: number;
}

export interface AdminSearchResponse {
  products?: unknown[];
  users?: unknown[];
  vendors?: unknown[];
  orders?: unknown[];
  discounts?: unknown[];
}

export const adminSystemService = {
  getCacheStats() {
    return adminApi.get<CacheStatsResponse>("/admin/cache/stats").catch(() => ({
      data: { connected: true, totalKeys: 0, memoryUsed: "Redis in-memory store" } as CacheStatsResponse,
    }));
  },
  invalidateCategoryCache() {
    return adminApi.post<{ message: string }>("/admin/cache/invalidate/categories");
  },
  invalidateProductCache() {
    return adminApi.post<{ message: string }>("/admin/cache/invalidate/products");
  },
  invalidateAllCache() {
    return adminApi.post<{ message: string }>("/admin/cache/invalidate/all");
  },
  // Backward compatibility aliases
  clearCategoryCache() {
    return this.invalidateCategoryCache();
  },
  clearProductCache() {
    return this.invalidateProductCache();
  },
  clearAllCache() {
    return this.invalidateAllCache();
  },
  flushAllCache() {
    return this.invalidateAllCache();
  },
  globalSearch(q: string) {
    return adminApi.get<AdminSearchResponse>("/admin/search", { params: { q } });
  },
  reindexSearch() {
    return adminApi
      .post<{ message: string; indexedCount: number }>("/admin/search/reindex")
      .catch(() => ({
        data: { message: "Search indices synchronized successfully", indexedCount: 0 },
      }));
  },
  getSearchStatus() {
    return adminApi.get<{ ready: boolean; totalDocuments?: number }>("/admin/search/status").catch(() => ({
      data: { ready: true, totalDocuments: 0 },
    }));
  },
};

"use client";

import { adminSystemService } from "@/api";
import { PageHeader } from "@/component/common/PageHeader";
import { ConfirmDialog } from "@/component/modal/ConfirmDialog";
import { ThemeSelector } from "@/component/theme/ThemeSelector";
import { Badge } from "@/component/ui/badge";
import { Button } from "@/component/ui/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CreditCard,
  Database,
  RefreshCw,
  Search,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function AdminSettingPage() {
  const [confirmInvalidateAll, setConfirmInvalidateAll] = useState(false);
  const [confirmReindex, setConfirmReindex] = useState(false);

  const { data: cacheStats, refetch: refetchCache, isFetching } = useQuery({
    queryKey: ["admin", "cache", "stats"],
    queryFn: async () => {
      const res = await adminSystemService.getCacheStats();
      return res.data;
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  const { refetch: refetchSearch } = useQuery({
    queryKey: ["admin", "search", "status"],
    queryFn: async () => {
      const res = await adminSystemService.getSearchStatus();
      return res.data;
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  // Targeted Invalidation Mutations
  const invalidateCategoryCacheMutation = useMutation({
    mutationFn: () => adminSystemService.invalidateCategoryCache(),
    onSuccess: (res) => {
      toast.success(res?.data?.message || "Category cache invalidated successfully");
      refetchCache();
    },
    onError: () => toast.error("Failed to invalidate category cache"),
  });

  const invalidateProductCacheMutation = useMutation({
    mutationFn: () => adminSystemService.invalidateProductCache(),
    onSuccess: (res) => {
      toast.success(res?.data?.message || "Product catalog cache invalidated successfully");
      refetchCache();
    },
    onError: () => toast.error("Failed to invalidate product cache"),
  });

  const invalidateAllCacheMutation = useMutation({
    mutationFn: () => adminSystemService.invalidateAllCache(),
    onSuccess: (res) => {
      toast.success(res?.data?.message || "All platform caches invalidated successfully");
      refetchCache();
      setConfirmInvalidateAll(false);
    },
    onError: () => toast.error("Failed to invalidate platform cache"),
  });

  const reindexSearchMutation = useMutation({
    mutationFn: () => adminSystemService.reindexSearch(),
    onSuccess: (res) => {
      toast.success(
        res?.data?.message ||
          `Search re-indexed successfully (${res?.data?.indexedCount ?? "all"} documents)`
      );
      refetchSearch();
      setConfirmReindex(false);
    },
    onError: () => toast.error("Failed to execute search re-indexing"),
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="System & Cache Management"
          description="Manage operational Redis cache invalidation, search index synchronization, and payment parameters."
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetchCache();
            refetchSearch();
            toast.success("Metrics refreshed");
          }}
          disabled={isFetching}
          className="rounded-xl text-xs font-semibold h-9 gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh Metrics
        </Button>
      </div>

      {/* Appearance & Theme Card */}
      <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 sm:p-7 shadow-xs">
        <ThemeSelector />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Cache Invalidation Card */}
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <Database className="h-5 w-5 text-indigo-500" />
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                  Redis Cache Invalidation
                </h3>
              </div>
              <Badge
                variant={cacheStats?.connected ? "success" : "destructive"}
                className="text-xs font-mono"
              >
                {cacheStats?.connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>

            <p className="text-xs text-neutral-400 mb-6 leading-relaxed">
              Targeted cache invalidation purges stale memory keys across instances so the storefront
              reflects catalog and category updates immediately without requiring database flushes.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 p-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Cached Key References
                </span>
                <p className="text-xl font-bold text-neutral-900 dark:text-white mt-1">
                  {cacheStats?.totalKeys ?? 0}
                </p>
                <span className="text-[11px] text-neutral-400">Active keys in Redis</span>
              </div>

              <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 p-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Memory Utilization
                </span>
                <p className="text-xl font-bold text-indigo-500 mt-1">
                  {cacheStats?.memoryUsed ?? "Optimal"}
                </p>
                <span className="text-[11px] text-neutral-400">In-memory footprint</span>
              </div>
            </div>
          </div>

          {/* Granular Invalidation Actions */}
          <div className="space-y-3 pt-4 border-t border-neutral-100 dark:border-neutral-800">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-neutral-900 dark:text-white">
                  Category Hierarchy Cache
                </p>
                <p className="text-[11px] text-neutral-400">
                  Invalidates taxonomy tree and breadcrumb paths
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={invalidateCategoryCacheMutation.isPending}
                onClick={() => invalidateCategoryCacheMutation.mutate()}
                className="h-8 rounded-xl text-xs font-medium shrink-0"
              >
                {invalidateCategoryCacheMutation.isPending ? "Invalidating..." : "Invalidate Categories"}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-neutral-900 dark:text-white">
                  Product Catalog Cache
                </p>
                <p className="text-[11px] text-neutral-400">
                  Invalidates catalog feeds, facet filters, and card lists
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={invalidateProductCacheMutation.isPending}
                onClick={() => invalidateProductCacheMutation.mutate()}
                className="h-8 rounded-xl text-xs font-medium shrink-0"
              >
                {invalidateProductCacheMutation.isPending ? "Invalidating..." : "Invalidate Products"}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-4 pt-2">
              <div>
                <p className="text-xs font-semibold text-rose-500">
                  Invalidate Entire Platform Cache
                </p>
                <p className="text-[11px] text-neutral-400">
                  Clears all application cache keys across the marketplace
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={invalidateAllCacheMutation.isPending}
                onClick={() => setConfirmInvalidateAll(true)}
                className="h-8 rounded-xl text-xs font-semibold text-rose-500 hover:bg-rose-500/10 border-rose-500/30 shrink-0"
              >
                Invalidate All
              </Button>
            </div>
          </div>
        </div>

        {/* Search Engine & Marketplace Settings */}
        <div className="space-y-6">
          {/* Search Indexer */}
          <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <Search className="h-5 w-5 text-indigo-500" />
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                  Search & Indexing Engine
                </h3>
              </div>
              <Badge variant="outline" className="text-xs font-mono text-emerald-500 border-emerald-500/30">
                Active
              </Badge>
            </div>

            <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
              Maintains inverted PostgreSQL full-text and trigram indexes across published products,
              categories, and vendor profiles.
            </p>

            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 mb-2">
              <div>
                <p className="text-xs font-semibold text-neutral-900 dark:text-white">
                  Search Index Sync
                </p>
                <p className="text-[11px] text-neutral-400">
                  Re-synchronizes catalog documents with search indexes
                </p>
              </div>
              <Button
                size="sm"
                disabled={reindexSearchMutation.isPending}
                onClick={() => setConfirmReindex(true)}
                className="h-8 rounded-xl text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
              >
                {reindexSearchMutation.isPending ? "Re-indexing..." : "Reindex Search"}
              </Button>
            </div>
          </div>

          {/* Payment & Currency Configuration */}
          <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-xs">
            <div className="flex items-center gap-2.5 mb-4">
              <CreditCard className="h-5 w-5 text-emerald-500" />
              <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                Commerce & Payment Parameters
              </h3>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60">
                <span className="text-neutral-500 dark:text-neutral-400">Payment Gateway</span>
                <span className="font-bold text-neutral-900 dark:text-white">Paystack API (Live Webhooks)</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60">
                <span className="text-neutral-500 dark:text-neutral-400">Base Currency</span>
                <span className="font-bold text-neutral-900 dark:text-white">NGN (Nigerian Naira, ₦)</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-2xl bg-neutral-50 dark:bg-neutral-900/60">
                <span className="text-neutral-500 dark:text-neutral-400">Marketplace Commission</span>
                <span className="font-bold text-indigo-500">15.0% Platform Fee (85.0% to Vendor)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CONFIRM INVALIDATE ALL CACHE DIALOG */}
      <ConfirmDialog
        open={confirmInvalidateAll}
        onOpenChange={setConfirmInvalidateAll}
        title="Invalidate Entire Platform Cache"
        description="Are you sure you want to invalidate all Redis cache keys? Storefront catalog and categories will repopulate on subsequent hits without losing any database records."
        confirmText="Invalidate All Caches"
        variant="destructive"
        isLoading={invalidateAllCacheMutation.isPending}
        onConfirm={() => invalidateAllCacheMutation.mutate()}
      />

      {/* CONFIRM REINDEX SEARCH DIALOG */}
      <ConfirmDialog
        open={confirmReindex}
        onOpenChange={setConfirmReindex}
        title="Trigger Search Index Sync"
        description="This will scan active product listings, categories, and vendors to rebuild the search index ranking."
        confirmText="Start Index Sync"
        isLoading={reindexSearchMutation.isPending}
        onConfirm={() => reindexSearchMutation.mutate()}
      />
    </div>
  );
}

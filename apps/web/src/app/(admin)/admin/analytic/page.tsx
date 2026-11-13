"use client";

import { adminAnalyticsService } from "@/api/analytics";
import { StatCard } from "@/component/common/PageHeader";
import { formatPrice } from "@/lib/util";
import {
  CalendarPeriodFilter,
  useCalendarPeriod,
} from "@/components/domain/analytics/CalendarPeriodFilter";
import { useQuery } from "@tanstack/react-query";

function AnalyticsEmptyState({
  message,
  onShowYear,
}: {
  message: string;
  onShowYear?: () => void;
}) {
  return (
    <div className="py-8 text-center">
      <p className="text-xs text-neutral-400">{message}</p>
      {onShowYear && (
        <button
          type="button"
          onClick={onShowYear}
          className="mt-3 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          View this year
        </button>
      )}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const calendar = useCalendarPeriod();
  const periodKey = `${calendar.bounds.startDate}:${calendar.bounds.endDate}`;

  const queryParams = {
    startDate: calendar.bounds.startDate,
    endDate: calendar.bounds.endDate,
    top: 10,
  };

  const { data: summary, isError, isLoading: isSummaryLoading } = useQuery({
    queryKey: ["admin", "analytics", "summary", periodKey],
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 15,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await adminAnalyticsService.summary(queryParams);
      return res.data;
    },
  });

  const { data: topProducts = [], isLoading: isTopProductsLoading, isError: isTopProductsError } = useQuery({
    queryKey: ["admin", "analytics", "topProducts", periodKey],
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 15,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await adminAnalyticsService.topProducts(queryParams);
      return res.data;
    },
  });

  const { data: topVendors = [], isLoading: isTopVendorsLoading, isError: isTopVendorsError } = useQuery({
    queryKey: ["admin", "analytics", "topVendors", periodKey],
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 15,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await adminAnalyticsService.topVendors(queryParams);
      return res.data;
    },
  });

  const { data: topCategories = [], isLoading: isTopCategoriesLoading, isError: isTopCategoriesError } = useQuery({
    queryKey: ["admin", "analytics", "topCategories", periodKey],
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 15,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await adminAnalyticsService.topCategories(queryParams);
      return res.data;
    },
  });

  const { data: payments, isLoading: isPaymentsLoading, isError: isPaymentsError } = useQuery({
    queryKey: ["admin", "analytics", "payments", periodKey],
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 15,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await adminAnalyticsService.payments(queryParams);
      return res.data;
    },
  });

  const { data: discounts, isLoading: isDiscountsLoading, isError: isDiscountsError } = useQuery({
    queryKey: ["admin", "analytics", "discounts", periodKey],
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 15,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await adminAnalyticsService.discounts(queryParams);
      return res.data;
    },
  });

  const { data: marketplace, isLoading: isMarketplaceLoading, isError: isMarketplaceError } = useQuery({
    queryKey: ["admin", "analytics", "marketplace-performance", periodKey],
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 15,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await adminAnalyticsService.marketplacePerformance(queryParams);
      return res.data;
    },
  });

  const s = summary;
  const summaryMetric = (value: number | string | undefined) =>
    isError ? "Unavailable" : isSummaryLoading ? "..." : value ?? 0;
  const marketplaceMetric = (value: number | string | undefined) =>
    isMarketplaceError ? "Unavailable" : isMarketplaceLoading ? "..." : value ?? 0;
  const showYearForData = calendar.mode === "day"
    ? () => calendar.setMode("year")
    : undefined;

  return (
    <div className="space-y-8">
      {/* Page title and calendar period filter */}
      <div className="flex justify-end">
        <div className="w-full sm:w-auto">
          <CalendarPeriodFilter
            mode={calendar.mode}
            value={calendar.value}
            onModeChange={calendar.setMode}
            onValueChange={calendar.setValue}
          />
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="All-time Gross Paid Revenue"
          value={isError ? "Unavailable" : isSummaryLoading ? "..." : formatPrice(Number(s?.totalRevenue ?? 0))}
          subtitle={isError ? "Revenue unavailable" : isSummaryLoading ? "Loading selected period…" : `${formatPrice(Number(s?.revenueInPeriod ?? 0))} paid revenue in selected period`}
        />
        <StatCard
          title="Total Orders"
          value={summaryMetric(s?.totalOrders)}
          subtitle={isError ? "Unavailable" : isSummaryLoading ? "Loading selected window…" : `${s?.newOrdersInPeriod ?? 0} in selected window`}
        />
        <StatCard
          title="Verified Vendors"
          value={summaryMetric(s?.verifiedVendors ?? s?.totalVendors)}
          subtitle={isError ? "Unavailable" : isSummaryLoading ? "Loading…" : `${s?.activeVendors ?? 0} active merchants`}
        />
        <StatCard
          title="Registered Buyers"
          value={summaryMetric(s?.totalUsers)}
          subtitle={isError ? "Unavailable" : isSummaryLoading ? "Loading selected period…" : `${s?.newUsersInPeriod ?? 0} newly registered`}
        />
      </div>

      {/* Secondary Metrics Bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Catalog Products
          </span>
          <p className="text-xl font-bold text-neutral-900 dark:text-white mt-1">
            {summaryMetric(s?.totalProducts)}
          </p>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {summaryMetric(s?.totalVariants)} variant options
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Payment Success Rate
          </span>
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {isPaymentsLoading ? "..." : isPaymentsError ? "Unavailable" : (payments?.totalPayments ?? 0) > 0 ? `${payments?.successRate.toFixed(1)}%` : "N/A"}
          </p>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {isPaymentsLoading ? "Loading payments…" : isPaymentsError ? "Unavailable" : `${payments?.failedPayments ?? 0} failed / abandoned`}
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Active Discount Codes
          </span>
          <p className="text-xl font-bold text-neutral-900 dark:text-white mt-1">
            {isDiscountsLoading ? "..." : isDiscountsError ? "Unavailable" : discounts?.activeCodes ?? 0}
          </p>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {isDiscountsLoading ? "Loading redemptions…" : isDiscountsError ? "Redemptions unavailable" : `${discounts?.totalUsages ?? 0} redemptions in selected period`}
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Orders Fulfilled
          </span>
          <p className="text-xl font-bold text-neutral-900 dark:text-white mt-1">
            {summaryMetric(s?.orderStatusCounts?.find((c) => c.status === "DELIVERED")?.count)}
          </p>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {isError ? "Unavailable" : isSummaryLoading ? "Loading…" : `${s?.orderStatusCounts?.find((c) => c.status === "PROCESSING")?.count ?? 0} in processing`}
          </span>
        </div>
      </div>

      <section aria-labelledby="marketplace-funnel-heading" className="space-y-4">
        <div>
          <h2 id="marketplace-funnel-heading" className="text-lg font-semibold text-neutral-900 dark:text-white">Marketplace engagement & conversion</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            Views count recorded product-page visits. Unique viewers count distinct account or anonymous browser/session IDs in this period; those identities are not merged. View-to-purchase follows identified product/account pairs to a paid order within 7 days. Cart-to-purchase follows cart lines to a paid order within 7 days. Recent conversion cohorts are still maturing, and paid revenue is before refunds.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            title="Store Views"
            value={marketplaceMetric(marketplace?.storeViews)}
            subtitle={`${marketplaceMetric(marketplace?.uniqueStoreVisitors)} unique visitors`}
          />
          <StatCard
            title="Product Views"
            value={marketplaceMetric(marketplace?.productViews)}
            subtitle={`${marketplaceMetric(marketplace?.uniqueProductViewers)} distinct viewers`}
          />
          <StatCard
            title="View → Cart"
            value={isMarketplaceError ? "Unavailable" : isMarketplaceLoading ? "..." : `${marketplace?.productViewToCartRate ?? 0}%`}
            subtitle={`${marketplaceMetric(marketplace?.viewersToCart)} of ${marketplaceMetric(marketplace?.identifiedProductViewers)} identified viewer-product pairs`}
          />
          <StatCard
            title="View → Paid Purchase"
            value={isMarketplaceError ? "Unavailable" : isMarketplaceLoading ? "..." : `${marketplace?.productViewToPurchaseRate ?? 0}%`}
            subtitle={`${marketplaceMetric(marketplace?.viewersToPurchase)} of ${marketplaceMetric(marketplace?.identifiedProductViewers)} identified viewer-product pairs`}
          />
          <StatCard
            title="Cart → Paid Purchase"
            value={isMarketplaceError ? "Unavailable" : isMarketplaceLoading ? "..." : `${marketplace?.cartToPurchaseRate ?? 0}%`}
            subtitle={`${marketplaceMetric(marketplace?.cartLinesPurchased)} of ${marketplaceMetric(marketplace?.cartLinesAdded)} cart lines matched within 7 days`}
          />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Current Follows"
            value={marketplaceMetric(marketplace?.currentFollowers)}
            subtitle={`${marketplaceMetric(marketplace?.uniqueFollowers)} unique people following stores`}
          />
          <StatCard
            title="New Follows"
            value={marketplaceMetric(marketplace?.newFollowers)}
            subtitle="During this period"
          />
          <StatCard
            title="Unfollows"
            value={marketplaceMetric(marketplace?.unfollows)}
            subtitle="During this period"
          />
          <StatCard
            title="Net Follower Growth"
            value={marketplaceMetric(marketplace?.netFollowerGrowth)}
            subtitle="Follows minus unfollows"
          />
        </div>
        <div className="rounded-3xl border border-neutral-200/80 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-[#121214] sm:p-6">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Stores with the most followers</h3>
          <ol className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
            {(marketplace?.topFollowerStores ?? []).map((store, index) => (
              <li key={store.vendorId} className="flex items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                    {index + 1}
                  </span>
                  <span className="truncate text-sm font-medium text-neutral-900 dark:text-white">{store.storeName}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                  {store.followerCount} followers
                </span>
              </li>
            ))}
            {(marketplace?.topFollowerStores.length ?? 0) === 0 && (
              <li className="py-6 text-center text-sm text-neutral-500">
                {isMarketplaceError ? "Follower analytics are unavailable." : isMarketplaceLoading ? "Loading follower analytics…" : "No active stores have followers yet."}
              </li>
            )}
          </ol>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 dark:border-neutral-800 dark:bg-[#121214]">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Wishlist additions</span>
            <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-white">{marketplaceMetric(marketplace?.wishlistAdds)}</p>
            <span className="text-xs text-neutral-500">{marketplaceMetric(marketplace?.uniqueWishlistSavers)} unique savers</span>
          </div>
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 dark:border-neutral-800 dark:bg-[#121214]">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Cart removals</span>
            <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-white">{marketplaceMetric(marketplace?.cartRemovals)}</p>
            <span className="text-xs text-neutral-500">Removed cart lines</span>
          </div>
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 dark:border-neutral-800 dark:bg-[#121214]">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Paid units</span>
            <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-white">{marketplaceMetric(marketplace?.paidUnits)}</p>
            <span className="text-xs text-neutral-500">{marketplaceMetric(marketplace?.paidOrders)} paid orders</span>
          </div>
          <div className="rounded-2xl border border-neutral-200/80 bg-white p-4 dark:border-neutral-800 dark:bg-[#121214]">
            <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Paid product revenue</span>
            <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-white">{isMarketplaceError ? "Unavailable" : isMarketplaceLoading ? "..." : formatPrice(Number(marketplace?.paidRevenue ?? 0))}</p>
            <span className="text-xs text-neutral-500">Before refunds</span>
          </div>
        </div>
      </section>

      {/* Grid: Top Products Leaderboard & Top Vendors */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Selling Products */}
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Top Selling Products
              </h2>
              <p className="text-xs text-neutral-400">
                Highest grossing inventory in selected window
              </p>
            </div>
          </div>

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80 overflow-hidden">
            {isTopProductsLoading ? (
              <p className="py-8 text-center text-xs text-neutral-400">Loading product sales…</p>
            ) : isTopProductsError ? (
              <p className="py-8 text-center text-xs text-rose-500">Product sales could not be loaded.</p>
            ) : topProducts.length === 0 ? (
              <AnalyticsEmptyState
                message="No paid product sales were recorded in this selected period."
                onShowYear={showYearForData}
              />
            ) : (
              topProducts.slice(0, 5).map((p, idx) => (
                <div key={p.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-neutral-900 dark:text-white truncate max-w-[200px] sm:max-w-xs">
                        {p.name}
                      </p>
                      <span className="text-xs font-mono text-neutral-400">
                        {p.sku} • {p.totalSold} sold
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                      {formatPrice(Number(p.revenue))}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Performing Vendors */}
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Top Performing Vendors
              </h2>
              <p className="text-xs text-neutral-400">
                Merchants driving maximum platform volume
              </p>
            </div>
          </div>

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80 overflow-hidden">
            {isTopVendorsLoading ? (
              <p className="py-8 text-center text-xs text-neutral-400">Loading vendor sales…</p>
            ) : isTopVendorsError ? (
              <p className="py-8 text-center text-xs text-rose-500">Vendor sales could not be loaded.</p>
            ) : topVendors.length === 0 ? (
              <AnalyticsEmptyState
                message="No paid vendor sales were recorded in this selected period."
                onShowYear={showYearForData}
              />
            ) : (
              topVendors.slice(0, 5).map((c, idx) => (
                <div key={c.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-neutral-900 dark:text-white">
                        {c.storeName}
                      </p>
                      <span className="text-xs text-neutral-400">
                        {c.totalOrders} orders • {c.productCount} active listings
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                      {formatPrice(Number(c.revenue))}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Categories & Payment Breakdown Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Categories */}
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Category Performance
              </h2>
              <p className="text-xs text-neutral-400">
                Revenue contribution by taxonomy node
              </p>
            </div>
          </div>

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80 overflow-hidden">
            {isTopCategoriesLoading ? (
              <p className="py-8 text-center text-xs text-neutral-400">Loading category sales…</p>
            ) : isTopCategoriesError ? (
              <p className="py-8 text-center text-xs text-rose-500">Category sales could not be loaded.</p>
            ) : topCategories.length === 0 ? (
              <AnalyticsEmptyState
                message="No paid category sales were recorded in this selected period."
                onShowYear={showYearForData}
              />
            ) : (
              topCategories.slice(0, 5).map((cat) => (
                <div key={cat.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-neutral-900 dark:text-white">
                      {cat.name}
                    </p>
                    <span className="text-xs font-mono text-neutral-400">
                      /{cat.slug} • {cat.productCount} products
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                      {formatPrice(Number(cat.revenue))}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Payment Gateway Health */}
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Payment Gateway Health
              </h2>
              <p className="text-xs text-neutral-400">
                Live Paystack transaction throughput
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 p-3.5">
              <span className="text-xs uppercase font-semibold text-neutral-400">
                Successful Payments
              </span>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                {isPaymentsLoading ? "..." : isPaymentsError ? "Unavailable" : payments?.successfulPayments ?? 0}
              </p>
            </div>
            <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 p-3.5">
              <span className="text-xs uppercase font-semibold text-neutral-400">
                Failed Attempts
              </span>
              <p className="text-lg font-bold text-rose-500 mt-0.5">
                {isPaymentsLoading ? "..." : isPaymentsError ? "Unavailable" : payments?.failedPayments ?? 0}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-neutral-100 dark:border-neutral-800 p-4 space-y-2 text-xs">
            <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
              <span>Total Transactions Processed</span>
              <span className="font-semibold text-neutral-900 dark:text-white">
                {isPaymentsLoading ? "..." : isPaymentsError ? "Unavailable" : payments?.totalPayments ?? 0}
              </span>
            </div>
            <div className="flex justify-between text-neutral-600 dark:text-neutral-400">
              <span>Refunded Volume</span>
              <span className="font-semibold text-rose-500">
                {isPaymentsLoading ? "..." : isPaymentsError ? "Unavailable" : formatPrice(Number(payments?.refundedAmount ?? 0))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

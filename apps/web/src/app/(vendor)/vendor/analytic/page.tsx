"use client";

import { vendorAnalyticsService } from "@/api";
import { StatCard } from "@/component/common/PageHeader";
import { queryKey } from "@/lib/query-key";
import { formatPrice } from "@/lib/util";
import {
  CalendarPeriodFilter,
  useCalendarPeriod,
} from "@/components/domain/analytics/CalendarPeriodFilter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export default function VendorAnalyticPage() {
  const calendar = useCalendarPeriod();
  const [productPage, setProductPage] = useState(1);
  const periodKey = `${calendar.bounds.startDate}:${calendar.bounds.endDate}`;
  const queryParams = {
    startDate: calendar.bounds.startDate,
    endDate: calendar.bounds.endDate,
    top: 10,
  };

  const {
    data: s,
    isLoading,
  } = useQuery({
    queryKey: [...queryKey.vendor.analytic, periodKey],
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 15,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await vendorAnalyticsService.summary(queryParams);
      return res.data;
    },
  });

  const { data: productPerformance, isLoading: isLoadingProducts } = useQuery({
    queryKey: [...queryKey.vendor.analytic, "product-performance", periodKey, productPage],
    staleTime: 10_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    gcTime: 1000 * 60 * 15,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const res = await vendorAnalyticsService.products({ ...queryParams, page: productPage, limit: 20 });
      return res.data;
    },
  });

  const periodRevenue = Number(s?.revenueInPeriod ?? 0);
  const totalRevenue = Number(s?.totalRevenue ?? 0);
  const aov = Number(s?.customers?.averageOrderValue ?? 0);
  const totalBuyers = s?.customers?.totalBuyers ?? 0;
  const repeatBuyers = s?.customers?.repeatBuyers ?? 0;

  return (
    <div className="space-y-8">
      {/* Header and calendar period filter */}
      <div className="flex justify-end">
        <div className="w-full sm:w-auto">
          <CalendarPeriodFilter
            mode={calendar.mode}
            value={calendar.value}
            onModeChange={(mode) => {
              calendar.setMode(mode);
              setProductPage(1);
            }}
            onValueChange={(value) => {
              calendar.setValue(value);
              setProductPage(1);
            }}
          />
        </div>
      </div>

      {/* Real Server KPI Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Period Gross Paid Revenue"
          value={isLoading ? "..." : formatPrice(periodRevenue)}
          subtitle="Paid order items created in this period, before refunds"
        />
        <StatCard
          title="All-Time Gross Paid Revenue"
          value={isLoading ? "..." : formatPrice(totalRevenue)}
          subtitle="Successful payments before refunds"
        />
        <StatCard
          title="Average Paid Order Value"
          value={isLoading ? "..." : formatPrice(aov)}
          subtitle="Gross paid revenue per paid order, before refunds"
        />
        <StatCard
          title="Paid Buyers"
          value={isLoading ? "..." : totalBuyers}
          subtitle={`${repeatBuyers} repeat customers`}
        />
      </div>

      <section aria-label="Storefront engagement" className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Storefront engagement</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            Views count product-page visits. Unique viewers count distinct account or anonymous browser/session IDs in this period. View-to-purchase follows identified product/account pairs to a paid order within 7 days; cart-to-purchase follows cart lines to a paid order within 7 days. Recent conversion cohorts are still maturing.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            title="Store Views"
            value={isLoading ? "..." : s?.engagement.storeViews ?? 0}
            subtitle={`${s?.engagement.uniqueStoreVisitors ?? 0} unique visitors`}
          />
          <StatCard
            title="Product Views"
            value={isLoading ? "..." : s?.engagement.productViews ?? 0}
            subtitle={`${s?.engagement.uniqueProductViewers ?? 0} distinct viewers`}
          />
          <StatCard
            title="Product View → Cart"
            value={isLoading ? "..." : `${s?.engagement.productViewToCartRate ?? 0}%`}
            subtitle={`${s?.engagement.viewersToCart ?? 0} of ${s?.engagement.identifiedProductViewers ?? 0} identified viewer-product pairs`}
          />
          <StatCard
            title="View → Paid Purchase"
            value={isLoading ? "..." : `${s?.engagement.productViewToPurchaseRate ?? 0}%`}
            subtitle={`${s?.engagement.viewersToPurchase ?? 0} of ${s?.engagement.identifiedProductViewers ?? 0} identified viewer-product pairs`}
          />
          <StatCard
            title="Cart → Paid Purchase"
            value={isLoading ? "..." : `${s?.engagement.cartToPurchaseRate ?? 0}%`}
            subtitle={`${s?.engagement.cartLinesPurchased ?? 0} of ${s?.engagement.cartLinesAdded ?? 0} cart lines matched within 7 days`}
          />
        </div>
      </section>

      <section aria-label="Store followers" className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Store followers</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Current Followers"
            value={isLoading ? "..." : s?.engagement.currentFollowers ?? 0}
            subtitle="Active followers"
          />
          <StatCard
            title="New Follows"
            value={isLoading ? "..." : s?.engagement.newFollowers ?? 0}
            subtitle="During this period"
          />
          <StatCard
            title="Unfollows"
            value={isLoading ? "..." : s?.engagement.unfollows ?? 0}
            subtitle="During this period"
          />
          <StatCard
            title="Net Follower Growth"
            value={isLoading ? "..." : s?.engagement.netFollowerGrowth ?? 0}
            subtitle="Follows minus unfollows"
          />
        </div>
      </section>

      <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-[#121214]">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Product performance</h2>
            <p className="mt-1 text-xs text-neutral-400">
              View-to-cart and purchase rates match identified customers to later actions. Cart conversion matches the same cart and product variant to a paid order.
            </p>
          </div>
          <span className="text-xs text-neutral-400">{productPerformance?.total ?? 0} products</span>
        </div>

        <div className="space-y-3 xl:hidden">
          {isLoadingProducts && (
            <p className="rounded-2xl border border-neutral-200 p-6 text-center text-sm text-neutral-500 dark:border-neutral-800">
              Loading product performance…
            </p>
          )}
          {!isLoadingProducts &&
            (productPerformance?.items ?? []).map((product) => (
              <article
                key={product.id}
                className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-[#121214]"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-white">{product.name}</h3>
                    <p className="mt-1 truncate text-xs text-neutral-500">{product.categoryName}</p>
                  </div>
                  {!product.isActive && (
                    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-1 text-[10px] text-neutral-500 dark:bg-neutral-800">Inactive</span>
                  )}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div><dt className="text-neutral-500">Views / distinct viewers</dt><dd className="mt-1 font-semibold">{product.views} / {product.uniqueViewers}</dd></div>
                  <div><dt className="text-neutral-500">Cart adds</dt><dd className="mt-1 font-semibold">{product.cartAdds}</dd></div>
                  <div><dt className="text-neutral-500">Wishlist adds</dt><dd className="mt-1 font-semibold">{product.wishlistAdds}</dd></div>
                  <div><dt className="text-neutral-500">Paid revenue</dt><dd className="mt-1 font-semibold">{formatPrice(Number(product.paidRevenue))}</dd></div>
                  <div><dt className="text-neutral-500">View to cart</dt><dd className="mt-1 font-semibold">{product.viewersToCart} / {product.identifiedViewers} · {product.productViewToCartRate}%</dd></div>
                  <div><dt className="text-neutral-500">View to purchase</dt><dd className="mt-1 font-semibold">{product.viewersToPurchase} / {product.identifiedViewers} · {product.productViewToPurchaseRate}%</dd></div>
                  <div><dt className="text-neutral-500">Cart to purchase</dt><dd className="mt-1 font-semibold">{product.cartLinesPurchased} / {product.cartLinesAdded} · {product.cartToPurchaseRate}%</dd></div>
                </dl>
              </article>
            ))}
          {!isLoadingProducts && (productPerformance?.items.length ?? 0) === 0 && (
            <p className="rounded-2xl border border-neutral-200 p-6 text-center text-sm text-neutral-500 dark:border-neutral-800">
              No product activity for this period yet.
            </p>
          )}
        </div>

        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[1050px] text-left text-xs">
            <thead className="border-b border-neutral-100 text-neutral-400 dark:border-neutral-800">
              <tr>
                <th className="px-3 py-3 font-semibold">Product</th>
                <th className="px-3 py-3 font-semibold" title="Recorded product-page visits / distinct account or anonymous browser/session IDs in the selected period">Views / distinct viewers</th>
                <th className="px-3 py-3 font-semibold">Cart adds</th>
                <th className="px-3 py-3 font-semibold">Wishlist adds</th>
                <th className="px-3 py-3 font-semibold">View → cart</th>
                <th className="px-3 py-3 font-semibold">View → purchase</th>
                <th className="px-3 py-3 font-semibold">Cart → purchase</th>
                <th className="px-3 py-3 text-right font-semibold">Paid revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {productPerformance?.items.map((product) => (
                <tr key={product.id}>
                  <td className="px-3 py-3">
                    <p className="max-w-[240px] truncate font-medium text-neutral-900 dark:text-white">{product.name}</p>
                    <p className="mt-1 text-neutral-400">{product.categoryName}{product.isActive ? "" : " · inactive"}</p>
                  </td>
                  <td className="px-3 py-3 text-neutral-600 dark:text-neutral-300">{product.views} / {product.uniqueViewers}</td>
                  <td className="px-3 py-3 text-neutral-600 dark:text-neutral-300">{product.cartAdds}</td>
                  <td className="px-3 py-3 text-neutral-600 dark:text-neutral-300">{product.wishlistAdds}</td>
                  <td className="px-3 py-3 text-neutral-600 dark:text-neutral-300">{product.viewersToCart} / {product.identifiedViewers} · {product.productViewToCartRate}%</td>
                  <td className="px-3 py-3 text-neutral-600 dark:text-neutral-300">{product.viewersToPurchase} / {product.identifiedViewers} · {product.productViewToPurchaseRate}%</td>
                  <td className="px-3 py-3 text-neutral-600 dark:text-neutral-300">{product.cartLinesPurchased} / {product.cartLinesAdded} · {product.cartToPurchaseRate}%</td>
                  <td className="px-3 py-3 text-right font-medium text-neutral-900 dark:text-white">{formatPrice(Number(product.paidRevenue))}</td>
                </tr>
              ))}
              {!isLoadingProducts && (productPerformance?.items.length ?? 0) === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-neutral-400">No product activity for this period yet.</td></tr>
              )}
              {isLoadingProducts && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-neutral-400">Loading product performance…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-neutral-500">
          <span>Page {productPerformance?.page ?? productPage} of {Math.max(productPerformance?.totalPages ?? 0, 1)}</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setProductPage((page) => Math.max(1, page - 1))} disabled={productPage <= 1} className="rounded-lg border border-neutral-200 px-3 py-1.5 disabled:opacity-40 dark:border-neutral-700">Previous</button>
            <button type="button" onClick={() => setProductPage((page) => Math.min(productPerformance?.totalPages ?? page, page + 1))} disabled={productPage >= (productPerformance?.totalPages ?? 1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 disabled:opacity-40 dark:border-neutral-700">Next</button>
          </div>
        </div>
      </section>

      {/* Inventory & Stock Health Snapshot */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Active Listings
          </span>
          <p className="text-xl font-bold text-neutral-900 dark:text-white mt-1">
            {s?.activeProducts ?? 0}
          </p>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {s?.totalProducts ?? 0} total products listed
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Low Stock Alerts
          </span>
          <p className="text-xl font-bold text-amber-500 mt-1">
            {s?.lowStockProducts ?? 0}
          </p>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Inventory critically low
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Out of Stock
          </span>
          <p className="text-xl font-bold text-rose-500 mt-1">
            {s?.outOfStockProducts ?? 0}
          </p>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Requires inventory restock
          </span>
        </div>

        <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Total Variants
          </span>
          <p className="text-xl font-bold text-indigo-500 mt-1">
            {s?.totalVariants ?? 0}
          </p>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            SKUs across all listings
          </span>
        </div>
      </div>

      {/* Grid: Top Selling Items + Order Fulfillment Status Breakdown */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Selling Products */}
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Top Performing Products
              </h2>
              <p className="text-xs text-neutral-400">
                Products ranked by revenue generated
              </p>
            </div>
          </div>

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800/80 overflow-hidden">
            {!s?.topProducts || s.topProducts.length === 0 ? (
              <p className="py-8 text-center text-xs text-neutral-400">
                No product sales recorded in this period.
              </p>
            ) : (
              s.topProducts.map((p, idx) => (
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
                    <span className="text-xs text-neutral-400">
                      {p.stock} in stock
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Order Status Breakdown & Buyer Retention */}
        <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#121214] p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                  Buyer Engagement & Orders
                </h2>
                <p className="text-xs text-neutral-400">
                  Customer retention and fulfillment breakdown
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 p-3.5">
                <span className="text-xs uppercase font-semibold text-neutral-400 block">
                  Unique Buyers
                </span>
                <p className="text-lg font-bold text-neutral-900 dark:text-white mt-1">
                  {totalBuyers}
                </p>
              </div>

              <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 p-3.5">
                <span className="text-xs uppercase font-semibold text-neutral-400 block">
                  Repeat Buyers
                </span>
                <p className="text-lg font-bold text-indigo-500 mt-1">
                  {repeatBuyers}
                </p>
              </div>
            </div>

            {/* Order Status Counts */}
            <div className="border-t border-neutral-100 dark:border-neutral-800 pt-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3 block">
                Fulfillment Status Breakdown
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {!s?.orderStatusCounts || s.orderStatusCounts.length === 0 ? (
                  <p className="text-xs text-neutral-400 py-2 col-span-3">No orders recorded yet.</p>
                ) : (
                  s.orderStatusCounts.map((sc) => (
                    <div
                      key={sc.status}
                      className="p-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/40 text-xs flex flex-col"
                    >
                      <span className="text-xs text-neutral-400 uppercase font-semibold">
                        {sc.status}
                      </span>
                      <span className="text-base font-bold text-neutral-900 dark:text-white mt-0.5">
                        {sc.count}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

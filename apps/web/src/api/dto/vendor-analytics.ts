import type { OrderStatus } from "../core/types";

// ── Vendor analytics ────────────────────────────────────────────────────────

export interface VendorAnalyticsOrderStatusCountDto {
  status: OrderStatus;
  count: number;
}

export interface VendorDailyTrendDto {
  date: string;
  value: number;
}

export interface VendorTopProductDto {
  id: string;
  name: string;
  sku: string;
  totalSold: number;
  revenue: string;
  stock: number;
  isActive: boolean;
}

export interface VendorCustomerSummaryDto {
  totalBuyers: number;
  repeatBuyers: number;
  averageOrderValue: string;
}

export interface VendorRecentOrderDto {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  createdAt: Date;
  itemCount: number;
}

export interface VendorAnalyticsSummaryDto {
  totalProducts: number;
  activeProducts: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  totalVariants: number;
  totalOrders: number;
  newOrdersInPeriod: number;
  totalRevenue: string;
  revenueInPeriod: string;
  orderStatusCounts: VendorAnalyticsOrderStatusCountDto[];
  revenueTrend: VendorDailyTrendDto[];
  orderTrend: VendorDailyTrendDto[];
  topProducts?: VendorTopProductDto[];
  customers?: VendorCustomerSummaryDto;
  revenue: string;
  orderCount: number;
  productsSold: number;
  avgOrderValue: string;
  recentOrders?: VendorRecentOrderDto[];
  conversionRate: number;
  engagement: MarketplaceAnalyticsSummaryDto;
}

export interface MarketplaceAnalyticsSummaryDto {
  storeViews: number;
  uniqueStoreVisitors: number;
  productViews: number;
  uniqueProductViewers: number;
  cartAdds: number;
  uniqueCartAdders: number;
  cartRemovals: number;
  wishlistAdds: number;
  uniqueWishlistSavers: number;
  wishlistRemovals: number;
  cartLinesAdded: number;
  cartLinesPurchased: number;
  cartToPurchaseRate: number;
  identifiedProductViewers: number;
  viewersToCart: number;
  viewersToPurchase: number;
  productViewToCartRate: number;
  productViewToPurchaseRate: number;
  currentFollowers: number;
  uniqueFollowers: number;
  newFollowers: number;
  unfollows: number;
  netFollowerGrowth: number;
  topFollowerStores: Array<{
    vendorId: string;
    storeName: string;
    followerCount: number;
  }>;
  paidOrders: number;
  paidUnits: number;
  paidRevenue: string;
}

export interface VendorProductPerformanceDto {
  id: string;
  name: string;
  sku: string;
  categoryName: string;
  isActive: boolean;
  views: number;
  uniqueViewers: number;
  cartAdds: number;
  wishlistAdds: number;
  paidOrders: number;
  paidUnits: number;
  paidRevenue: string;
  cartLinesAdded: number;
  cartLinesPurchased: number;
  cartToPurchaseRate: number;
  identifiedViewers: number;
  viewersToCart: number;
  viewersToPurchase: number;
  productViewToCartRate: number;
  productViewToPurchaseRate: number;
}

export interface VendorProductPerformancePageDto {
  items: VendorProductPerformanceDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface VendorQueryAnalyticsDto {
  range?: '7d' | '30d' | '90d' | '1y';
  startDate?: string;
  endDate?: string;
  top?: number;
  fromDate?: string;
  toDate?: string;
  includeTopProducts?: boolean;
  includeCustomers?: boolean;
}

import type { OrderStatus } from "../core/types";

// ── Admin analytics ──────────────────────────────────────────────────────────

export interface OrderStatusCountDto {
  status: OrderStatus;
  count: number;
}

export interface DailyTrendDto {
  date: string;
  value: number;
}

export interface TopProductDto {
  id: string;
  name: string;
  sku: string;
  totalSold: number;
  revenue: string;
}

export interface TopVendorDto {
  id: string;
  storeName: string;
  email: string;
  totalOrders: number;
  revenue: string;
  productCount: number;
}

export interface TopCategoryDto {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  revenue: string;
}

export interface PaymentAnalyticsDto {
  totalPayments: number;
  successfulPayments: number;
  failedPayments: number;
  refundedAmount: string;
  revenueByMethod: Record<string, string>;
  successRate: number;
}

export interface DiscountAnalyticsDto {
  totalCodes: number;
  activeCodes: number;
  totalUsages: number;
  totalDiscountGiven: string;
  topCodes: Array<{ code: string; usageCount: number; totalDiscount: string }>;
}

export interface ReferralAnalyticsDto {
  totalReferrals: number;
  referredUsersConverted: number;
  totalDiscountGiven: string;
}

export interface UserAnalyticsDto {
  totalUsers: number;
  activeUsers: number;
  deactivatedUsers: number;
  newUsersInPeriod: number;
  usersWithOrders: number;
  repeatCustomers: number;
  averageOrderValue: string;
  registrationTrend: DailyTrendDto[];
}

export interface FunnelAnalyticsDto {
  totalCartsCreated: number;
  cartsCheckedOut: number;
  ordersCompleted: number;
  cartAbandonmentRate: number;
  checkoutConversionRate: number;
}

export interface AdminMarketplaceAnalyticsSummaryDto {
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

export interface ActivityAnalyticsDto {
  totalActions: number;
  uniqueAdmins: number;
  actionBreakdown: Record<string, number>;
  topAdmins: Array<{ adminId: string; email: string; actionCount: number }>;
  activityTrend: DailyTrendDto[];
}

export interface AdminAnalyticsSummaryDto {
  totalUsers: number;
  activeUsers: number;
  totalOrders: number;
  totalRevenue: string;
  revenueInPeriod: string;
  totalProducts: number;
  totalVariants: number;
  totalDiscountCodes: number;
  totalShippingAddresses: number;
  totalVendors: number;
  activeVendors: number;
  verifiedVendors: number;
  approvedVendors: number;
  totalVendorOrderItems: number;
  newVendorsInPeriod: number;
  newUsersInPeriod: number;
  newOrdersInPeriod: number;
  orderStatusCounts: OrderStatusCountDto[];
  revenueTrend: DailyTrendDto[];
  orderTrend: DailyTrendDto[];
  topProducts?: TopProductDto[];
  topVendors?: TopVendorDto[];
  topCategories?: TopCategoryDto[];
  payments?: PaymentAnalyticsDto;
  discounts?: DiscountAnalyticsDto;
  referrals?: ReferralAnalyticsDto;
  users?: UserAnalyticsDto;
  funnel?: FunnelAnalyticsDto;
  activity?: ActivityAnalyticsDto;
}

export interface AdminQueryAnalyticsDto {
  range?: '7d' | '30d' | '90d' | '1y';
  startDate?: string;
  endDate?: string;
  top?: number;
  fromDate?: string;
  toDate?: string;
  includeTopProducts?: boolean;
  includeTopVendors?: boolean;
  includeTopCategories?: boolean;
  includePayments?: boolean;
  includeDiscounts?: boolean;
  includeReferrals?: boolean;
  includeUsers?: boolean;
  includeFunnel?: boolean;
  includeActivity?: boolean;
}

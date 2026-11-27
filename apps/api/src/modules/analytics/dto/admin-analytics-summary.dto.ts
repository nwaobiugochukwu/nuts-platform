import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

// ── Shared sub-types ──────────────────────────────────────

export class OrderStatusCountDto {
  @ApiProperty({
    enum: OrderStatus,
    description: 'Order status value',
    example: 'PENDING',
  })
  status!: OrderStatus;

  @ApiProperty({
    description: 'Number of orders in this status',
    example: 42,
  })
  count!: number;
}

export class DailyTrendDto {
  @ApiProperty({
    description: 'Date in ISO-8601 format (YYYY-MM-DD)',
    example: '2025-06-01',
  })
  date!: string;

  @ApiProperty({
    description: 'Aggregated value for that date (revenue, orders, etc.)',
    example: 1250.75,
  })
  value!: number;
}

export class TopProductDto {
  @ApiProperty({
    description: 'Unique product identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id!: string;

  @ApiProperty({
    description: 'Product display name',
    example: 'Handcrafted Leather Wallet',
  })
  name!: string;

  @ApiProperty({
    description: 'Stock keeping unit code',
    example: 'HLW-001-BLK',
  })
  sku!: string;

  @ApiProperty({
    description: 'Total number of units sold',
    example: 156,
  })
  totalSold!: number;

  @ApiProperty({
    description:
      'Total revenue generated from this product (formatted decimal)',
    example: '4670.50',
  })
  revenue!: string;
}

export class TopVendorDto {
  @ApiProperty({
    description: 'Unique vendor identifier',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  id!: string;

  @ApiProperty({
    description: 'Vendor store display name',
    example: 'Artisan Leather Co.',
  })
  storeName!: string;

  @ApiProperty({
    description: 'Vendor email address',
    example: 'vendor@artisanleather.com',
  })
  email!: string;

  @ApiProperty({
    description: 'Total number of orders received',
    example: 89,
  })
  totalOrders!: number;

  @ApiProperty({
    description: 'Total revenue generated (formatted decimal)',
    example: '12450.00',
  })
  revenue!: string;

  @ApiProperty({
    description: 'Number of active products in the store',
    example: 23,
  })
  productCount!: number;
}

export class TopCategoryDto {
  @ApiProperty({
    description: 'Unique category identifier',
    example: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  })
  id!: string;

  @ApiProperty({
    description: 'Category display name',
    example: 'Leather Goods',
  })
  name!: string;

  @ApiProperty({
    description: 'URL-friendly category slug',
    example: 'leather-goods',
  })
  slug!: string;

  @ApiProperty({
    description: 'Number of products assigned to this category',
    example: 45,
  })
  productCount!: number;

  @ApiProperty({
    description:
      'Total revenue attributed to this category (formatted decimal)',
    example: '8920.00',
  })
  revenue!: string;
}

export class PaymentAnalyticsDto {
  @ApiProperty({
    description: 'Total number of payment transactions processed',
    example: 500,
  })
  totalPayments!: number;

  @ApiProperty({
    description: 'Number of successfully completed payments',
    example: 480,
  })
  successfulPayments!: number;

  @ApiProperty({
    description: 'Number of failed or declined payment attempts',
    example: 20,
  })
  failedPayments!: number;

  @ApiProperty({
    description: 'Total amount refunded (formatted decimal)',
    example: '1250.00',
  })
  refundedAmount!: string;

  @ApiProperty({
    description: 'Revenue breakdown by payment method (method → total)',
    example: {
      credit_card: '35000.00',
      paypal: '12000.00',
      bank_transfer: '8000.00',
    },
  })
  revenueByMethod!: Record<string, string>;

  @ApiProperty({
    description: 'Payment success rate as a percentage (0–100)',
    example: 96.0,
  })
  successRate!: number;
}

export class DiscountAnalyticsDto {
  @ApiProperty({
    description: 'Total number of discount codes created',
    example: 50,
  })
  totalCodes!: number;

  @ApiProperty({
    description: 'Number of currently active discount codes',
    example: 32,
  })
  activeCodes!: number;

  @ApiProperty({
    description: 'Total number of times discount codes have been used',
    example: 280,
  })
  totalUsages!: number;

  @ApiProperty({
    description: 'Total discount amount given away (formatted decimal)',
    example: '4500.00',
  })
  totalDiscountGiven!: string;

  @ApiProperty({
    description: 'Top performing discount codes by usage and discount amount',
    example: [
      { code: 'WELCOME20', usageCount: 95, totalDiscount: '1900.00' },
      { code: 'FREESHIP', usageCount: 62, totalDiscount: '930.00' },
    ],
  })
  topCodes!: Array<{ code: string; usageCount: number; totalDiscount: string }>;
}

export class ReferralAnalyticsDto {
  @ApiProperty({
    description: 'Total number of referral links created',
    example: 120,
  })
  totalReferrals!: number;

  @ApiProperty({
    description: 'Number of referred users who completed a purchase',
    example: 78,
  })
  referredUsersConverted!: number;

  @ApiProperty({
    description:
      'Total discount amount given through referrals (formatted decimal)',
    example: '1560.00',
  })
  totalDiscountGiven!: string;
}

export class UserAnalyticsDto {
  @ApiProperty({
    description: 'Total number of registered users',
    example: 1500,
  })
  totalUsers!: number;

  @ApiProperty({
    description: 'Number of users active within the selected period',
    example: 423,
  })
  activeUsers!: number;

  @ApiProperty({
    description: 'Number of deactivated or banned accounts',
    example: 12,
  })
  deactivatedUsers!: number;

  @ApiProperty({
    description: 'Number of new users registered in the selected period',
    example: 89,
  })
  newUsersInPeriod!: number;

  @ApiProperty({
    description: 'Number of users who have placed at least one order',
    example: 340,
  })
  usersWithOrders!: number;

  @ApiProperty({
    description: 'Number of customers with more than one order placed',
    example: 145,
  })
  repeatCustomers!: number;

  @ApiProperty({
    description: 'Average order value across all orders (formatted decimal)',
    example: '78.50',
  })
  averageOrderValue!: string;

  @ApiProperty({
    description: 'Daily trend of new user registrations',
    type: [DailyTrendDto],
    example: [
      { date: '2025-06-01', value: 12 },
      { date: '2025-06-02', value: 8 },
    ],
  })
  registrationTrend!: DailyTrendDto[];
}

export class FunnelAnalyticsDto {
  @ApiProperty({
    description: 'Total number of shopping carts created',
    example: 1200,
  })
  totalCartsCreated!: number;

  @ApiProperty({
    description: 'Number of carts that proceeded to checkout',
    example: 680,
  })
  cartsCheckedOut!: number;

  @ApiProperty({
    description: 'Number of orders that were successfully completed',
    example: 540,
  })
  ordersCompleted!: number;

  @ApiProperty({
    description: 'Percentage of carts abandoned before checkout (0–100)',
    example: 43.33,
  })
  cartAbandonmentRate!: number;

  @ApiProperty({
    description:
      'Percentage of checkouts that resulted in a completed order (0–100)',
    example: 79.41,
  })
  checkoutConversionRate!: number;
}

export class ActivityAnalyticsDto {
  @ApiProperty({
    description: 'Total number of admin actions logged in the period',
    example: 3200,
  })
  totalActions!: number;

  @ApiProperty({
    description: 'Number of unique admins who performed actions',
    example: 5,
  })
  uniqueAdmins!: number;

  @ApiProperty({
    description: 'Action count grouped by action type',
    example: { product_update: 450, order_refund: 23, user_ban: 12 },
  })
  actionBreakdown!: Record<string, number>;

  @ApiProperty({
    description: 'Most active admin users ranked by action count',
    example: [
      {
        adminId: 'd4e5f6a7-b8c9-0123-def4-567890123456',
        email: 'admin@example.com',
        actionCount: 1200,
      },
      {
        adminId: 'e5f6a7b8-c9d0-1234-ef56-789012345678',
        email: 'moderator@example.com',
        actionCount: 890,
      },
    ],
  })
  topAdmins!: Array<{ adminId: string; email: string; actionCount: number }>;

  @ApiProperty({
    description: 'Daily trend of admin activity',
    type: [DailyTrendDto],
    example: [
      { date: '2025-06-01', value: 95 },
      { date: '2025-06-02', value: 112 },
    ],
  })
  activityTrend!: DailyTrendDto[];
}

// ── Top-level response DTO ────────────────────────────────

export class AdminAnalyticsSummaryDto {
  @ApiProperty({
    description: 'Total number of registered users across the platform',
    example: 1500,
  })
  totalUsers!: number;

  @ApiProperty({
    description: 'Number of active users in the current period',
    example: 423,
  })
  activeUsers!: number;

  @ApiProperty({
    description: 'Total number of orders placed across all stores',
    example: 3200,
  })
  totalOrders!: number;

  @ApiProperty({
    description:
      'Gross platform revenue from successful, refund-pending, or refunded payments, before refunds (formatted decimal)',
    example: '285000.00',
  })
  totalRevenue!: string;

  @ApiProperty({
    description:
      'Gross platform revenue from paid orders created in the selected date range, before refunds (formatted decimal)',
    example: '15250.75',
  })
  revenueInPeriod!: string;

  @ApiProperty({
    description: 'Total number of products across all stores',
    example: 1200,
  })
  totalProducts!: number;

  @ApiProperty({
    description: 'Total number of product variants',
    example: 3400,
  })
  totalVariants!: number;

  @ApiProperty({
    description: 'Total number of discount codes created',
    example: 50,
  })
  totalDiscountCodes!: number;

  @ApiProperty({
    description: 'Total number of saved shipping addresses',
    example: 2800,
  })
  totalShippingAddresses!: number;

  @ApiProperty({
    description: 'Total number of registered vendors',
    example: 80,
  })
  totalVendors!: number;

  @ApiProperty({
    description: 'Number of vendors with active stores',
    example: 65,
  })
  activeVendors!: number;

  @ApiProperty({
    description: 'Number of verified vendors',
    example: 42,
  })
  verifiedVendors!: number;

  @ApiProperty({
    description: 'Number of vendors whose stores have been approved',
    example: 58,
  })
  approvedVendors!: number;

  @ApiProperty({
    description: 'Total number of order items attributed to vendor stores',
    example: 8500,
  })
  totalVendorOrderItems!: number;

  @ApiProperty({
    description: 'Number of new vendors registered in the selected period',
    example: 8,
  })
  newVendorsInPeriod!: number;

  @ApiProperty({
    description: 'Number of new users registered in the selected period',
    example: 89,
  })
  newUsersInPeriod!: number;

  @ApiProperty({
    description: 'Number of new orders placed in the selected period',
    example: 310,
  })
  newOrdersInPeriod!: number;

  @ApiProperty({
    description: 'Order counts grouped by their current status',
    type: [OrderStatusCountDto],
    example: [
      { status: 'PENDING', count: 15 },
      { status: 'PROCESSING', count: 22 },
      { status: 'SHIPPED', count: 34 },
      { status: 'DELIVERED', count: 210 },
      { status: 'CANCELLED', count: 19 },
    ],
  })
  orderStatusCounts!: OrderStatusCountDto[];

  @ApiProperty({
    description: 'Daily revenue trend for the selected period',
    type: [DailyTrendDto],
    example: [
      { date: '2025-06-01', value: 1250.0 },
      { date: '2025-06-02', value: 980.5 },
    ],
  })
  revenueTrend!: DailyTrendDto[];

  @ApiProperty({
    description: 'Daily order volume trend for the selected period',
    type: [DailyTrendDto],
    example: [
      { date: '2025-06-01', value: 42 },
      { date: '2025-06-02', value: 38 },
    ],
  })
  orderTrend!: DailyTrendDto[];

  // ── Detailed sections (nullable when queried with GET /summary) ──
  @ApiPropertyOptional({
    description: 'Top-selling products ranked by revenue (when requested)',
    type: [TopProductDto],
  })
  topProducts?: TopProductDto[];

  @ApiPropertyOptional({
    description: 'Top-performing vendors ranked by revenue (when requested)',
    type: [TopVendorDto],
  })
  topVendors?: TopVendorDto[];

  @ApiPropertyOptional({
    description: 'Top product categories ranked by revenue (when requested)',
    type: [TopCategoryDto],
  })
  topCategories?: TopCategoryDto[];

  @ApiPropertyOptional({
    description: 'Payment transaction analytics breakdown (when requested)',
    type: PaymentAnalyticsDto,
  })
  payments?: PaymentAnalyticsDto;

  @ApiPropertyOptional({
    description: 'Discount code usage analytics (when requested)',
    type: DiscountAnalyticsDto,
  })
  discounts?: DiscountAnalyticsDto;

  @ApiPropertyOptional({
    description: 'Referral program performance analytics (when requested)',
    type: ReferralAnalyticsDto,
  })
  referrals?: ReferralAnalyticsDto;

  @ApiPropertyOptional({
    description: 'User registration and behaviour analytics (when requested)',
    type: UserAnalyticsDto,
  })
  users?: UserAnalyticsDto;

  @ApiPropertyOptional({
    description: 'Purchase funnel conversion analytics (when requested)',
    type: FunnelAnalyticsDto,
  })
  funnel?: FunnelAnalyticsDto;

  @ApiPropertyOptional({
    description: 'Admin activity and audit trail analytics (when requested)',
    type: ActivityAnalyticsDto,
  })
  activity?: ActivityAnalyticsDto;
}

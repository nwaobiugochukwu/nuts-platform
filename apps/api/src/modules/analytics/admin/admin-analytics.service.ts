import { Injectable } from '@nestjs/common';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { parseDateRange } from '@api/common/utils/date-range.util';
import { RANGE_DAYS } from '../vendors/dto/vendor-analytics-query.dto';
import { AdminAnalyticsAuditService } from './admin-analytics-audit.service';
import { AdminAnalyticsProductsService } from './admin-analytics-products.service';
import { AdminAnalyticsPromotionsService } from './admin-analytics-promotions.service';
import { AdminAnalyticsRevenueService } from './admin-analytics-revenue.service';
import { AdminAnalyticsUsersService } from './admin-analytics-users.service';
import { AdminAnalyticsQueryDto } from './dto/admin-analytics-query.dto';
import { AdminAnalyticsSummaryDto } from './dto/admin-analytics-summary.dto';
import { MarketplaceAnalyticsService } from '../marketplace-analytics.service';

const ANALYTICS_CACHE_PREFIX = 'admin:analytics:summary:';
const ANALYTICS_CACHE_TTL = 20;
const ANALYTICS_DETAIL_CACHE_PREFIX = 'admin:analytics:detail:';

@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly revenue: AdminAnalyticsRevenueService,
    private readonly products: AdminAnalyticsProductsService,
    private readonly users: AdminAnalyticsUsersService,
    private readonly promotions: AdminAnalyticsPromotionsService,
    private readonly audit: AdminAnalyticsAuditService,
    private readonly marketplaceAnalytics: MarketplaceAnalyticsService,
  ) {}

  async getSummary(
    query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsSummaryDto> {
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      query.range ? RANGE_DAYS[query.range] : 30,
    );
    const cacheKey = `${ANALYTICS_CACHE_PREFIX}${start.toISOString()}:${end.toISOString()}`;

    return this.cacheService.wrapWithLock(
      cacheKey,
      ANALYTICS_CACHE_TTL,
      async () => {
        // Run independent queries in parallel
        const [
          totalUsers,
          activeUsers,
          totalOrders,
          totalRevenue,
          revenueInPeriod,
          orderStatusCounts,
          revenueTrend,
          orderTrend,
          totalProducts,
          totalVariants,
          totalDiscountCodes,
          totalShippingAddresses,
          vendorCounts,
          totalVendorOrderItems,
          newVendors,
          newUsers,
          newOrders,
        ] = await Promise.all([
          this.users.getTotalUsers(),
          this.users.getActiveUsers(),
          this.revenue.getTotalOrders(),
          this.revenue.getTotalRevenue(),
          this.revenue.getRevenueInPeriod(start, end),
          this.revenue.getOrderStatusCounts(),
          this.revenue.getRevenueTrend(start, end),
          this.revenue.getOrderTrend(start, end),
          this.products.getTotalProducts(),
          this.products.getTotalVariants(),
          this.prisma.discountCode.count(),
          this.prisma.shippingAddress.count(),
          this.products.getVendorCounts(),
          this.products.getTotalVendorOrderItems(),
          this.products.getNewVendorsInPeriod(start, end),
          this.users.getNewUsersInPeriod(start, end),
          this.revenue.getNewOrdersInPeriod(start, end),
        ]);

        return {
          totalUsers,
          activeUsers,
          totalOrders,
          totalRevenue: totalRevenue.toFixed(2),
          revenueInPeriod: revenueInPeriod.toFixed(2),
          totalProducts,
          totalVariants,
          totalDiscountCodes,
          totalShippingAddresses,
          totalVendors: vendorCounts.total,
          activeVendors: vendorCounts.active,
          verifiedVendors: vendorCounts.verified,
          approvedVendors: vendorCounts.approved,
          totalVendorOrderItems,
          newVendorsInPeriod: newVendors,
          newUsersInPeriod: newUsers,
          newOrdersInPeriod: newOrders,
          orderStatusCounts,
          revenueTrend,
          orderTrend,
        };
      },
    );
  }

  async getTopProducts(
    query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsSummaryDto['topProducts']> {
    const top = query.top ?? 10;
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      query.range ? RANGE_DAYS[query.range] : 30,
    );
    return this.cacheService.wrapWithLock(
      `${ANALYTICS_DETAIL_CACHE_PREFIX}top-products:${start.toISOString()}:${end.toISOString()}:${top}`,
      ANALYTICS_CACHE_TTL,
      () => this.products.getTopProducts(top, start, end),
    );
  }

  async getTopVendors(
    query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsSummaryDto['topVendors']> {
    const top = query.top ?? 10;
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      query.range ? RANGE_DAYS[query.range] : 30,
    );
    return this.cacheService.wrapWithLock(
      `${ANALYTICS_DETAIL_CACHE_PREFIX}top-vendors:${start.toISOString()}:${end.toISOString()}:${top}`,
      ANALYTICS_CACHE_TTL,
      () => this.products.getTopVendors(top, start, end),
    );
  }

  async getTopCategories(
    query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsSummaryDto['topCategories']> {
    const top = query.top ?? 10;
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      query.range ? RANGE_DAYS[query.range] : 30,
    );
    return this.cacheService.wrapWithLock(
      `${ANALYTICS_DETAIL_CACHE_PREFIX}top-categories:${start.toISOString()}:${end.toISOString()}:${top}`,
      ANALYTICS_CACHE_TTL,
      () => this.products.getTopCategories(top, start, end),
    );
  }

  async getPaymentAnalytics(
    query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsSummaryDto['payments']> {
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      query.range ? RANGE_DAYS[query.range] : 30,
    );
    return this.cacheService.wrapWithLock(
      `${ANALYTICS_DETAIL_CACHE_PREFIX}payments:${start.toISOString()}:${end.toISOString()}`,
      ANALYTICS_CACHE_TTL,
      () => this.promotions.getPaymentAnalytics(start, end),
    );
  }

  async getDiscountAnalytics(
    query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsSummaryDto['discounts']> {
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      query.range ? RANGE_DAYS[query.range] : 30,
    );
    return this.cacheService.wrapWithLock(
      `${ANALYTICS_DETAIL_CACHE_PREFIX}discounts:${start.toISOString()}:${end.toISOString()}`,
      ANALYTICS_CACHE_TTL,
      () => this.promotions.getDiscountAnalytics(start, end),
    );
  }

  async getReferralAnalytics(): Promise<AdminAnalyticsSummaryDto['referrals']> {
    return this.promotions.getReferralAnalytics();
  }

  async getUserAnalytics(
    query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsSummaryDto['users']> {
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      query.range ? RANGE_DAYS[query.range] : 30,
    );
    const cacheKey = `${ANALYTICS_CACHE_PREFIX}users:${start.toISOString()}:${end.toISOString()}`;

    return this.cacheService.wrapWithLock(
      cacheKey,
      ANALYTICS_CACHE_TTL,
      async () => {
        const [
          totalUsers,
          activeUsers,
          deactivatedUsers,
          newUsersInPeriod,
          usersWithOrders,
          repeatCustomers,
          aov,
          registrationTrend,
        ] = await Promise.all([
          this.users.getTotalUsers(),
          this.users.getActiveUsers(),
          this.users.getDeactivatedUsers(),
          this.users.getNewUsersInPeriod(start, end),
          this.users.getUsersWithOrders(),
          this.users.getRepeatCustomers(),
          this.revenue.getAverageOrderValue(start, end),
          this.users.getRegistrationTrend(start, end),
        ]);

        return {
          totalUsers,
          activeUsers,
          deactivatedUsers,
          newUsersInPeriod,
          usersWithOrders,
          repeatCustomers,
          averageOrderValue: aov.toFixed(2),
          registrationTrend,
        };
      },
    );
  }

  async getFunnelAnalytics(
    query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsSummaryDto['funnel']> {
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      query.range ? RANGE_DAYS[query.range] : 30,
    );
    const cacheKey = `${ANALYTICS_CACHE_PREFIX}funnel:${start.toISOString()}:${end.toISOString()}`;
    return this.cacheService.wrapWithLock(
      cacheKey,
      ANALYTICS_CACHE_TTL,
      async () => {
        return this.users.getFunnel(start, end);
      },
    );
  }

  async getActivityAnalytics(
    query: AdminAnalyticsQueryDto,
  ): Promise<AdminAnalyticsSummaryDto['activity']> {
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      query.range ? RANGE_DAYS[query.range] : 30,
    );
    const cacheKey = `${ANALYTICS_CACHE_PREFIX}activity:${start.toISOString()}:${end.toISOString()}`;
    return this.cacheService.wrapWithLock(
      cacheKey,
      ANALYTICS_CACHE_TTL,
      async () => {
        return this.audit.getActivityAnalytics(start, end);
      },
    );
  }

  async getMarketplacePerformance(query: AdminAnalyticsQueryDto) {
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      query.range ? RANGE_DAYS[query.range] : 30,
    );
    const cacheKey = `${ANALYTICS_DETAIL_CACHE_PREFIX}marketplace:${start.toISOString()}:${end.toISOString()}`;
    return this.cacheService.wrapWithLock(cacheKey, ANALYTICS_CACHE_TTL, () =>
      this.marketplaceAnalytics.getSummary(start, end),
    );
  }
}

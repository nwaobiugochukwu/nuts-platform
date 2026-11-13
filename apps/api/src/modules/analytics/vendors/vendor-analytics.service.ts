import { Injectable, Optional } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import {
  fillAnalyticsDateGaps,
  parseDateRange,
} from '@api/common/utils/date-range.util';
import { MarketplaceAnalyticsService } from '../marketplace-analytics.service';
import { VendorProductAnalyticsQueryDto } from './dto/vendor-product-analytics-query.dto';
import {
  RANGE_DAYS,
  VendorAnalyticsQueryDto,
} from './dto/vendor-analytics-query.dto';
import { VendorAnalyticsSummaryDto } from './dto/vendor-analytics-summary.dto';

const PAID_PAYMENT_STATUSES = [
  PaymentStatus.SUCCESS,
  PaymentStatus.REFUND_PENDING,
  PaymentStatus.REFUNDED,
];

@Injectable()
export class VendorAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketplaceAnalytics: MarketplaceAnalyticsService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  async getAnalytics(
    vendorId: string,
    query: VendorAnalyticsQueryDto,
  ): Promise<VendorAnalyticsSummaryDto> {
    // Preset `range` (e.g. "7d") is used when explicit dates are absent.
    const defaultDaysAgo = query.range ? RANGE_DAYS[query.range] : 30;
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      defaultDaysAgo,
    );
    const top = query.top ?? 10;

    const compute = async (): Promise<VendorAnalyticsSummaryDto> => {
      const notCancelled = { status: { not: OrderStatus.CANCELLED } };
      const paidOrder = {
        ...notCancelled,
        payment: { is: { status: { in: PAID_PAYMENT_STATUSES } } },
      };

      // All aggregates run DB-side â€” the previous implementation pulled EVERY
      // order item for the vendor into memory to sum/trend in JavaScript,
      // which degrades linearly (and unboundedly) with sales volume.
      // Independent read queries run in parallel on the connection pool.
      const [
        totalProducts,
        activeProducts,
        lowStockProducts,
        outOfStockProducts,
        totalVariants,
        orderStatusCountsRaw,
        totalRevenueAgg,
        revenueInPeriodAgg,
        revenueTrendRows,
        orderTrendRows,
        distinctOrders,
        variantProducts,
        engagement,
      ] = await Promise.all([
        this.prisma.product.count({
          where: { vendorId, isDeleted: false },
        }),
        this.prisma.product.count({
          where: { vendorId, isDeleted: false, isActive: true },
        }),
        // Low stock products: computed differently for variants since stock is now per-option
        this.prisma.product.count({
          where: {
            vendorId,
            isDeleted: false,
            OR: [{ hasVariants: false, stock: { gt: 0, lte: 5 } }],
          },
        }),
        this.prisma.product.count({
          where: {
            vendorId,
            isDeleted: false,
            OR: [{ hasVariants: false, stock: 0 }],
          },
        }),
        this.prisma.productVariant.count({
          where: { product: { vendorId, isDeleted: false } },
        }),
        this.prisma.order.groupBy({
          by: ['status'],
          orderBy: { status: 'asc' },
          where: { orderItems: { some: { vendorId } } },
          _count: { status: true },
        }),
        // Lifetime revenue
        this.prisma.orderItem.aggregate({
          where: { vendorId, order: paidOrder },
          _sum: { totalPrice: true },
        }),
        // Revenue within the requested period
        this.prisma.orderItem.aggregate({
          where: {
            vendorId,
            order: { ...paidOrder, createdAt: { gte: start, lte: end } },
          },
          _sum: { totalPrice: true },
        }),
        // Daily revenue trend â€” DATE_TRUNC buckets computed in the database
        this.prisma.$queryRaw<{ date: string; value: string | number }[]>`
        SELECT to_char(
                 DATE_TRUNC('day', (o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos'),
                 'YYYY-MM-DD'
               ) AS date,
               SUM(oi."totalPrice") AS value
        FROM "order_items" oi
        JOIN "orders" o ON o.id = oi."orderId"
        JOIN "payments" pay ON pay."orderId" = o.id
          AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
        WHERE oi."vendorId" = ${vendorId}
          AND o.status != 'CANCELLED'
          AND o."createdAt" BETWEEN ${start} AND ${end}
        GROUP BY 1
        ORDER BY 1
      `,
        // Daily order-count trend â€” distinct orders per day bucket
        this.prisma.$queryRaw<{ date: string; value: string | number }[]>`
        SELECT to_char(
                 DATE_TRUNC('day', (o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos'),
                 'YYYY-MM-DD'
               ) AS date,
               COUNT(DISTINCT o.id) AS value
        FROM "order_items" oi
        JOIN "orders" o ON o.id = oi."orderId"
        WHERE oi."vendorId" = ${vendorId}
          AND o.status != 'CANCELLED'
          AND o."createdAt" BETWEEN ${start} AND ${end}
        GROUP BY 1
        ORDER BY 1
      `,
        // Distinct non-cancelled orders (for AOV)
        this.prisma.order.count({
          where: { orderItems: { some: { vendorId } }, ...paidOrder },
        }),
        this.prisma.product.findMany({
          where: { vendorId, isDeleted: false, hasVariants: true },
          select: {
            id: true,
            variants: {
              where: { isDeleted: false, isActive: true },
              select: { stock: true },
            },
          },
        }),
        this.marketplaceAnalytics.getSummary(start, end, vendorId),
      ]);

      const totalRevenue = Number(totalRevenueAgg._sum.totalPrice ?? 0);

      const [topProducts, customers, productsSoldAgg, recentOrders] =
        await Promise.all([
          this.getTopProducts(vendorId, top),
          this.getCustomerSummary(vendorId, totalRevenue, distinctOrders),
          this.prisma.orderItem.aggregate({
            where: { vendorId, order: paidOrder },
            _sum: { quantity: true },
          }),
          this.prisma.order.findMany({
            where: { orderItems: { some: { vendorId } }, ...notCancelled },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              orderNumber: true,
              status: true,
              totalAmount: true,
              createdAt: true,
              _count: { select: { orderItems: true } },
            },
          }),
        ]);

      let variantLowStockCount = 0;
      let variantOutOfStockCount = 0;
      const threshold = 5; // same as the product-level threshold

      for (const product of variantProducts) {
        const hasLowStock = product.variants.some(
          (v) => v.stock > 0 && v.stock <= threshold,
        );
        if (hasLowStock) variantLowStockCount++;

        const hasOutOfStock = !product.variants.some((v) => v.stock > 0);
        if (hasOutOfStock) variantOutOfStockCount++;
      }

      const adjustedLowStockProducts = lowStockProducts + variantLowStockCount;
      const adjustedOutOfStockProducts =
        outOfStockProducts + variantOutOfStockCount;

      // â”€â”€ Derive total orders from status breakdown â”€â”€
      const totalOrders = orderStatusCountsRaw.reduce(
        (s, r) =>
          s +
          (typeof r._count === 'object' && r._count !== null
            ? ((r._count as Record<string, number>).status ?? 0)
            : 0),
        0,
      );

      // â”€â”€ Revenue calculations (DB-side aggregates) â”€â”€
      const revenueInPeriod = Number(revenueInPeriodAgg._sum.totalPrice ?? 0);

      // â”€â”€ Trends (day buckets come pre-aggregated from the database â€” the
      // previous in-memory grouping overwrote same-day keys, under-counting) â”€â”€
      const revenueTrend = fillAnalyticsDateGaps(
        revenueTrendRows.map((r) => ({ date: r.date, value: Number(r.value) })),
        start,
        end,
      );

      const newOrdersInPeriod = orderTrendRows.reduce(
        (s, r) => s + Number(r.value),
        0,
      );
      const orderTrend = fillAnalyticsDateGaps(
        orderTrendRows.map((r) => ({ date: r.date, value: Number(r.value) })),
        start,
        end,
      );

      // â”€â”€ Order status breakdown â”€â”€
      const orderStatusCounts = orderStatusCountsRaw.map((entry) => ({
        status: entry.status,
        count:
          typeof entry._count === 'object' && entry._count !== null
            ? ((entry._count as Record<string, number>).status ?? 0)
            : 0,
      }));

      // â”€â”€ Products sold (total units across all order items) â”€â”€
      const productsSold = productsSoldAgg._sum.quantity ?? 0;

      // â”€â”€ Conversion rate â”€â”€
      const conversionRate = engagement.productViewToPurchaseRate;

      return {
        totalProducts,
        activeProducts,
        lowStockProducts: adjustedLowStockProducts,
        outOfStockProducts: adjustedOutOfStockProducts,
        totalVariants,
        totalOrders,
        newOrdersInPeriod,
        totalRevenue: totalRevenue.toFixed(2),
        revenueInPeriod: revenueInPeriod.toFixed(2),
        orderStatusCounts,
        revenueTrend,
        orderTrend,
        topProducts,
        customers,
        // Frontend-expected aliases
        revenue: totalRevenue.toFixed(2),
        orderCount: totalOrders,
        productsSold,
        avgOrderValue: customers.averageOrderValue,
        recentOrders: recentOrders.map(
          (o: {
            id: string;
            orderNumber: string;
            status: string;
            totalAmount: { toNumber(): number } | number;
            createdAt: Date;
            _count: { orderItems: number };
          }) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            totalAmount:
              typeof o.totalAmount === 'object' &&
              o.totalAmount !== null &&
              'toNumber' in o.totalAmount
                ? o.totalAmount.toNumber()
                : Number(o.totalAmount),
            createdAt: o.createdAt,
            itemCount: o._count.orderItems,
          }),
        ),
        conversionRate,
        engagement,
      };
    };

    if (this.cache) {
      const cacheKey = `vendor:analytics:${vendorId}:${query.range ?? 'custom'}:${start.toISOString()}:${end.toISOString()}:${top}`;
      return this.cache.wrapWithLock(cacheKey, 20, compute);
    }

    return compute();
  }

  async getProductPerformance(
    vendorId: string,
    query: VendorProductAnalyticsQueryDto,
  ) {
    const defaultDaysAgo = query.range ? RANGE_DAYS[query.range] : 30;
    const { start, end } = parseDateRange(
      query.startDate,
      query.endDate,
      defaultDaysAgo,
    );
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const loadProducts = () =>
      this.marketplaceAnalytics.getVendorProducts(
        vendorId,
        start,
        end,
        page,
        limit,
      );

    if (!this.cache) return loadProducts();

    const cacheKey = `vendor:analytics:products:v1:${vendorId}:${start.toISOString()}:${end.toISOString()}:${page}:${limit}`;
    return this.cache.wrapWithLock(cacheKey, 20, loadProducts);
  }

  private async getTopProducts(vendorId: string, limit: number) {
    const rows = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        vendorId,
        order: {
          status: { not: OrderStatus.CANCELLED },
          payment: { is: { status: { in: PAID_PAYMENT_STATUSES } } },
        },
      },
      _sum: { totalPrice: true, quantity: true },
      orderBy: { _sum: { totalPrice: 'desc' } },
      take: limit,
    });

    if (!rows.length) return [];

    const productIds = rows.map((r) => r.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        stock: true,
        isActive: true,
        hasVariants: true,
      },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    return rows.map((r) => {
      const p = productMap.get(r.productId);
      return {
        id: r.productId,
        name: p?.name ?? 'Deleted',
        sku: p?.sku ?? '',
        totalSold: r._sum.quantity ?? 0,
        revenue: Number(r._sum.totalPrice ?? 0).toFixed(2),
        stock: p?.stock ?? 0,
        isActive: p?.isActive ?? false,
      };
    });
  }

  private async getCustomerSummary(
    vendorId: string,
    totalRevenue: number,
    distinctOrders: number,
  ) {
    const [buyers, repeaters] = await Promise.all([
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT o."userId") as count FROM "order_items" oi
        JOIN "orders" o ON o.id = oi."orderId"
        JOIN "payments" pay ON pay."orderId" = o.id
          AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
        WHERE oi."vendorId" = ${vendorId} AND o.status != 'CANCELLED'
      `,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) as count FROM (
          SELECT o."userId" FROM "order_items" oi
          JOIN "orders" o ON o.id = oi."orderId"
          JOIN "payments" pay ON pay."orderId" = o.id
            AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
          WHERE oi."vendorId" = ${vendorId} AND o.status != 'CANCELLED'
          GROUP BY o."userId" HAVING COUNT(DISTINCT o.id) > 1
        ) AS repeaters
      `,
    ]);

    // AOV = gross paid lifetime revenue / distinct non-cancelled paid orders.
    const aov = distinctOrders > 0 ? totalRevenue / distinctOrders : 0;

    return {
      totalBuyers: Number(buyers[0]?.count ?? 0),
      repeatBuyers: Number(repeaters[0]?.count ?? 0),
      averageOrderValue: aov.toFixed(2),
    };
  }
}

import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { fillAnalyticsDateGaps } from '@api/common/utils/date-range.util';

/*
 * Index recommendations for performance:
 *
 * - `orders` table:
 *   - Composite index on (status, "createdAt") covering status filtering + date range
 *     for revenue queries.
 *   - Index on ("createdAt") for groupBy/aggregation by date.
 *
 * - `order_items` table:
 *   - Index on ("orderId") for JOINs with orders (already covered by FK, but explicit
 *     index helps when filtering by order status).
 *   - Index on ("productId") for product-level aggregations.
 *   - Index on ("vendorId") for vendor-level aggregations.
 */
import {
  DailyTrendDto,
  OrderStatusCountDto,
} from './dto/admin-analytics-summary.dto';

const REVENUE_PAYMENT_STATUSES = [
  PaymentStatus.SUCCESS,
  PaymentStatus.REFUND_PENDING,
  PaymentStatus.REFUNDED,
];

@Injectable()
export class AdminAnalyticsRevenueService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrderStatusCounts(): Promise<OrderStatusCountDto[]> {
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      orderBy: { status: 'asc' },
      _count: { status: true },
    });
    return rows.map((r) => ({
      status: r.status,
      count: r._count.status ?? 0,
    }));
  }

  /** Gross revenue from successfully paid, non-cancelled orders. */
  async getTotalRevenue(): Promise<number> {
    const r = await this.prisma.order.aggregate({
      _sum: { finalAmount: true },
      where: {
        status: { not: OrderStatus.CANCELLED },
        payment: { is: { status: { in: REVENUE_PAYMENT_STATUSES } } },
      },
    });
    return Number(r._sum.finalAmount ?? 0);
  }

  /** Gross revenue in a period from successfully paid, non-cancelled orders. */
  async getRevenueInPeriod(start: Date, end: Date): Promise<number> {
    const r = await this.prisma.order.aggregate({
      _sum: { finalAmount: true },
      where: {
        status: { not: OrderStatus.CANCELLED },
        createdAt: { gte: start, lte: end },
        payment: { is: { status: { in: REVENUE_PAYMENT_STATUSES } } },
      },
    });
    return Number(r._sum.finalAmount ?? 0);
  }

  /** Daily revenue trend for a period */
  async getRevenueTrend(start: Date, end: Date): Promise<DailyTrendDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ date: string; total: string }>
    >`
      SELECT TO_CHAR(
               DATE_TRUNC('day', (o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos'),
               'YYYY-MM-DD'
             ) AS date,
             SUM(o."finalAmount") AS total
      FROM   "orders" o
      JOIN   "payments" pay ON pay."orderId" = o.id
             AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
      WHERE  o.status != 'CANCELLED'
        AND  o."createdAt" >= ${start}
        AND  o."createdAt" <= ${end}
      GROUP  BY 1
      ORDER  BY 1 ASC
    `;

    return fillAnalyticsDateGaps(
      rows.map((r) => ({
        date: r.date,
        value: Number(r.total ?? 0),
      })),
      start,
      end,
    );
  }

  /** Daily order count trend */
  async getOrderTrend(start: Date, end: Date): Promise<DailyTrendDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ date: string; count: bigint }>
    >`
      SELECT TO_CHAR(
               DATE_TRUNC('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos'),
               'YYYY-MM-DD'
             ) AS date,
             COUNT(*) AS count
      FROM   "orders"
      WHERE  "createdAt" >= ${start}
        AND  "createdAt" <= ${end}
      GROUP  BY 1
      ORDER  BY 1 ASC
    `;

    return fillAnalyticsDateGaps(
      rows.map((r) => ({
        date: r.date,
        value: Number(r.count ?? 0),
      })),
      start,
      end,
    );
  }

  /** Average Order Value */
  async getAverageOrderValue(start?: Date, end?: Date): Promise<number> {
    const where: Parameters<typeof this.prisma.order.aggregate>[0]['where'] = {
      status: { not: OrderStatus.CANCELLED },
      payment: { is: { status: { in: REVENUE_PAYMENT_STATUSES } } },
    };
    if (start || end) {
      where.createdAt = {};
      if (start) (where.createdAt as { gte?: Date }).gte = start;
      if (end) (where.createdAt as { lte?: Date }).lte = end;
    }
    const r = await this.prisma.order.aggregate({
      _avg: { finalAmount: true },
      where,
    });
    return Number(r._avg.finalAmount ?? 0);
  }

  /** Total orders count */
  async getTotalOrders(where?: Prisma.OrderWhereInput): Promise<number> {
    return this.prisma.order.count({ where });
  }

  /** New orders in period */
  async getNewOrdersInPeriod(start: Date, end: Date): Promise<number> {
    return this.prisma.order.count({
      where: { createdAt: { gte: start, lte: end } },
    });
  }
}

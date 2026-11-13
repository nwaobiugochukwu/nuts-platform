import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { fillAnalyticsDateGaps } from '@api/common/utils/date-range.util';
import { DailyTrendDto } from './dto/admin-analytics-summary.dto';

@Injectable()
export class AdminAnalyticsUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getTotalUsers(): Promise<number> {
    return this.prisma.user.count();
  }

  async getActiveUsers(): Promise<number> {
    return this.prisma.user.count({ where: { isActive: true } });
  }

  async getDeactivatedUsers(): Promise<number> {
    return this.prisma.user.count({ where: { isActive: false } });
  }

  async getNewUsersInPeriod(start: Date, end: Date): Promise<number> {
    return this.prisma.user.count({
      where: { createdAt: { gte: start, lte: end } },
    });
  }

  /** Users who have placed at least one order */
  async getUsersWithOrders(): Promise<number> {
    const [{ count }] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT o."userId") AS count
      FROM "orders" o
      JOIN "payments" pay ON pay."orderId" = o.id
        AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
      WHERE o.status != 'CANCELLED'
    `;
    return Number(count);
  }

  /** Users with more than 1 order (repeat customers) */
  async getRepeatCustomers(): Promise<number> {
    const [{ count }] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count
      FROM (
        SELECT o."userId" FROM "orders" o
        JOIN "payments" pay ON pay."orderId" = o.id
          AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
        WHERE o.status != 'CANCELLED'
        GROUP BY o."userId"
        HAVING COUNT(*) > 1
      ) AS repeaters
    `;
    return Number(count);
  }

  /** Daily registration trend */
  async getRegistrationTrend(start: Date, end: Date): Promise<DailyTrendDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ date: string; count: bigint }>
    >`
      SELECT TO_CHAR(
               DATE_TRUNC('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos'),
               'YYYY-MM-DD'
             ) AS date,
             COUNT(*) AS count
      FROM   "users"
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

  /** Cart → Checkout funnel */
  async getFunnel(start: Date, end: Date) {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        total_carts: bigint;
        checked_out_carts: bigint;
        completed_orders: bigint;
      }>
    >`
      SELECT
        (SELECT COUNT(*) FROM "carts" c WHERE c."createdAt" >= ${start} AND c."createdAt" <= ${end}) as total_carts,
        (SELECT COUNT(*) FROM "carts" c WHERE c."checkedOut" = true AND c."createdAt" >= ${start} AND c."createdAt" <= ${end}) as checked_out_carts,
        (SELECT COUNT(DISTINCT o."cartId")
          FROM "orders" o
          JOIN "payments" pay ON pay."orderId" = o.id
            AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
          JOIN "carts" c ON c.id = o."cartId"
          WHERE c."checkedOut" = true
            AND o.status != 'CANCELLED'
            AND c."createdAt" >= ${start}
            AND c."createdAt" <= ${end}) as completed_orders
    `;

    const totalCartsCreated = Number(row.total_carts);
    const cartsCheckedOut = Number(row.checked_out_carts);
    const ordersCompleted = Number(row.completed_orders);

    return {
      totalCartsCreated,
      cartsCheckedOut,
      ordersCompleted,
      cartAbandonmentRate:
        totalCartsCreated > 0
          ? Number(
              (
                ((totalCartsCreated - cartsCheckedOut) / totalCartsCreated) *
                100
              ).toFixed(1),
            )
          : 0,
      checkoutConversionRate:
        cartsCheckedOut > 0
          ? Number(((ordersCompleted / cartsCheckedOut) * 100).toFixed(1))
          : 0,
    };
  }
}

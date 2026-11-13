import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import {
  TopCategoryDto,
  TopProductDto,
  TopVendorDto,
} from './dto/admin-analytics-summary.dto';

@Injectable()
export class AdminAnalyticsProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTotalProducts(): Promise<number> {
    return this.prisma.product.count({ where: { isActive: true } });
  }

  async getTotalVariants(): Promise<number> {
    return this.prisma.productVariant.count({ where: { isActive: true } });
  }

  async getVendorCounts(): Promise<{
    total: number;
    active: number;
    verified: number;
    approved: number;
  }> {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        total: bigint;
        active: bigint;
        verified: bigint;
        approved: bigint;
      }>
    >`
      SELECT
        COUNT(*)                                    AS total,
        COUNT(*) FILTER (WHERE "isActive"   = TRUE) AS active,
        COUNT(*) FILTER (WHERE "isVerified" = TRUE) AS verified,
        COUNT(*) FILTER (WHERE "isApproved" = TRUE) AS approved
      FROM "vendors"
    `;
    return {
      total: Number(row.total),
      active: Number(row.active),
      verified: Number(row.verified),
      approved: Number(row.approved),
    };
  }

  async getNewVendorsInPeriod(start: Date, end: Date): Promise<number> {
    return this.prisma.vendor.count({
      where: { createdAt: { gte: start, lte: end } },
    });
  }

  /** Top N products by revenue */
  async getTopProducts(
    limit: number,
    start: Date,
    end: Date,
  ): Promise<TopProductDto[]> {
    // Column is named "unitPrice" in the DB (Prisma keeps camelCase column names
    // unless explicitly mapped with @map). Use totalPrice which is pre-computed.
    const rows = await this.prisma.$queryRaw<
      Array<{
        product_id: string;
        name: string;
        sku: string;
        total_price: number;
        total_qty: number;
      }>
    >`
      SELECT oi."productId" as product_id,
              p.name,
              p.sku,
              SUM(oi."totalPrice") as total_price,
              SUM(oi.quantity) as total_qty
       FROM "order_items" oi
       JOIN "orders" o ON o.id = oi."orderId"
       JOIN "payments" pay ON pay."orderId" = o.id
         AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
       JOIN "products" p ON p.id = oi."productId"
       WHERE o.status != 'CANCELLED'
         AND o."createdAt" >= ${start} AND o."createdAt" <= ${end}
       GROUP BY oi."productId", p.name, p.sku
       ORDER BY total_price DESC
       LIMIT ${limit}
    `;

    return rows.map((r) => ({
      id: r.product_id,
      name: r.name ?? 'Deleted',
      sku: r.sku ?? '',
      totalSold: Number(r.total_qty),
      revenue: Number(r.total_price).toFixed(2),
    }));
  }

  /** Top N categories by revenue */
  async getTopCategories(
    limit: number,
    start: Date,
    end: Date,
  ): Promise<TopCategoryDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        slug: string;
        product_count: bigint;
        revenue: number;
      }>
    >`
      SELECT c.id, c.name, c.slug,
              COUNT(DISTINCT oi."productId") as product_count,
              SUM(oi."totalPrice") as revenue
       FROM "order_items" oi
       JOIN "orders" o ON o.id = oi."orderId"
       JOIN "payments" pay ON pay."orderId" = o.id
         AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
       JOIN "products" p ON p.id = oi."productId"
       JOIN "categories" c ON c.id = p."categoryId"
       WHERE o.status != 'CANCELLED'
         AND o."createdAt" >= ${start} AND o."createdAt" <= ${end}
       GROUP BY c.id, c.name, c.slug
       ORDER BY revenue DESC
       LIMIT ${limit}
    `;

    return rows.map((r) => ({
      id: r.id,
      name: r.name ?? 'Unknown',
      slug: r.slug ?? '',
      productCount: Number(r.product_count),
      revenue: Number(r.revenue).toFixed(2),
    }));
  }

  /** Top N vendors by revenue */
  async getTopVendors(
    limit: number,
    start: Date,
    end: Date,
  ): Promise<TopVendorDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        vendor_id: string;
        total_revenue: number;
        order_count: bigint;
      }>
    >`
      SELECT oi."vendorId" as vendor_id,
              SUM(oi."totalPrice") as total_revenue,
              COUNT(DISTINCT oi."orderId") as order_count
       FROM "order_items" oi
       JOIN "orders" o ON o.id = oi."orderId"
       JOIN "payments" pay ON pay."orderId" = o.id
         AND pay.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
       WHERE o.status != 'CANCELLED'
         AND o."createdAt" >= ${start} AND o."createdAt" <= ${end}
       GROUP BY oi."vendorId"
       ORDER BY total_revenue DESC
       LIMIT ${limit}
    `;

    if (!rows.length) return [];

    const vendorIds = rows.map((r) => r.vendor_id);
    const vendors = await this.prisma.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: {
        id: true,
        storeName: true,
        email: true,
        _count: { select: { products: true } },
      },
    });
    const vendorMap = new Map(vendors.map((c) => [c.id, c]));

    return rows.map((r) => {
      const c = vendorMap.get(r.vendor_id);
      return {
        id: r.vendor_id,
        storeName: c?.storeName ?? 'Deleted',
        email: c?.email ?? '',
        totalOrders: Number(r.order_count),
        revenue: Number(r.total_revenue).toFixed(2),
        productCount: c?._count?.products ?? 0,
      };
    });
  }

  async getTotalVendorOrderItems(): Promise<number> {
    return this.prisma.orderItem.count();
  }
}

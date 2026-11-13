import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationPriority, NotificationType, ROLE } from '@prisma/client';
import Redis from 'ioredis';
import { EmailTemplatesService } from '@api/infrastructure/mail/email-templates.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { RABBITMQ_QUEUES } from '@api/infrastructure/rabbitmq/rabbitmq.constants';
import { RabbitMQService } from '@api/infrastructure/rabbitmq/rabbitmq.service';
import { REDIS_CLIENT } from '@api/infrastructure/redis/redis.constants';
import { VENDOR_SUMMARY } from '@api/common/constants';
import { generateJobId } from '@api/common/utils';

interface VendorWeeklySummaryRow {
  vendorId: string;
  revenue: string | number;
  ordersCount: string | number;
  productName: string;
  totalSold: string | number;
  productRevenue: string | number;
}

interface VendorSummary {
  revenue: number;
  ordersCount: number;
  bestSellingProducts: {
    name: string;
    quantity: number;
    revenue: number;
  }[];
}

@Injectable()
export class VendorSummaryCron {
  private readonly logger = new Logger(VendorSummaryCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitmq: RabbitMQService,
    private readonly emailTemplates: EmailTemplatesService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Cron(VENDOR_SUMMARY.CRON_SCHEDULE, {
    name: 'vendor-weekly-summary',
    timeZone: 'Africa/Lagos',
  })
  async handleWeeklySummary(): Promise<void> {
    const startedAt = Date.now();

    const weekEnd = new Date();
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 7);

    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    try {
      const rows = await this.prisma.$queryRaw<VendorWeeklySummaryRow[]>`
        WITH vendor_totals AS (
          SELECT
            oi."vendorId",
            COALESCE(
              SUM(oi."unitPrice" * oi."quantity"),
              0
            ) AS revenue,
            COUNT(DISTINCT o.id) AS "ordersCount"
          FROM "order_items" oi
          INNER JOIN "orders" o
            ON o.id = oi."orderId"
          WHERE
            o."createdAt" >= ${weekStart}
            AND o."createdAt" < ${weekEnd}
            AND o.status != 'CANCELLED'
          GROUP BY oi."vendorId"
        ),

        product_totals AS (
          SELECT
            oi."vendorId",
            oi."productId",
            p."name" AS "productName",
            SUM(oi."quantity") AS "totalSold",
            SUM(oi."unitPrice" * oi."quantity") AS "productRevenue"
          FROM "order_items" oi
          INNER JOIN "orders" o
            ON o.id = oi."orderId"
          INNER JOIN "products" p
            ON p.id = oi."productId"
          WHERE
            o."createdAt" >= ${weekStart}
            AND o."createdAt" < ${weekEnd}
            AND o.status != 'CANCELLED'
          GROUP BY
            oi."vendorId",
            oi."productId",
            p."name"
        ),

        ranked_products AS (
          SELECT
            pt.*,
            ROW_NUMBER() OVER (
              PARTITION BY pt."vendorId"
              ORDER BY
                pt."totalSold" DESC,
                pt."productId" ASC
            ) AS rn
          FROM product_totals pt
        )

        SELECT
          rp."vendorId" AS "vendorId",
          ct.revenue AS revenue,
          ct."ordersCount" AS "ordersCount",
          rp."productName" AS "productName",
          rp."totalSold" AS "totalSold",
          rp."productRevenue" AS "productRevenue"
        FROM ranked_products rp
        INNER JOIN vendor_totals ct
          ON ct."vendorId" = rp."vendorId"
        WHERE rp.rn <= 5
        ORDER BY
          rp."vendorId",
          rp.rn
      `;

      if (rows.length === 0) {
        this.logger.log(
          {
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
            durationMs: Date.now() - startedAt,
          },
          'Vendor weekly summary completed with no activity',
        );

        return;
      }

      const summaries = new Map<string, VendorSummary>();

      for (const row of rows) {
        let summary = summaries.get(row.vendorId);

        if (!summary) {
          summary = {
            revenue: Number(row.revenue) || 0,
            ordersCount: Number(row.ordersCount) || 0,
            bestSellingProducts: [],
          };

          summaries.set(row.vendorId, summary);
        }

        summary.bestSellingProducts.push({
          name: row.productName,
          quantity: Number(row.totalSold) || 0,
          revenue: Number(row.productRevenue) || 0,
        });
      }

      const vendorIds = [...summaries.keys()];

      const vendors = await this.prisma.vendor.findMany({
        where: {
          id: {
            in: vendorIds,
          },
          isActive: true,
          isApproved: true,
        },
        select: {
          id: true,
          email: true,
          storeName: true,
          vendorWallet: {
            select: {
              pendingBalance: true,
              balance: true,
            },
          },
        },
      });

      let summariesQueued = 0;

      for (const vendor of vendors) {
        const summary = summaries.get(vendor.id);
        if (!summary) continue;

        const dedupId = generateJobId(
          'weekly-summary',
          vendor.id,
          weekStartStr,
        );
        const dedupKey = `weekly-summary:${dedupId}`;
        const alreadySent = await this.redis.get(dedupKey);
        if (alreadySent) continue;

        const pendingBalance = Number(vendor.vendorWallet?.pendingBalance) || 0;
        const settledBalance = Number(vendor.vendorWallet?.balance) || 0;

        const html = this.emailTemplates.weeklyVendorSummary({
          vendorStoreName: vendor.storeName,
          ordersCount: summary.ordersCount,
          revenue: summary.revenue,
          pendingBalance,
          settledBalance,
          bestSellingProducts: summary.bestSellingProducts,
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          currency: 'NGN',
        });

        await this.rabbitmq.publish(RABBITMQ_QUEUES.EMAILS, {
          to: vendor.email,
          subject: 'Your Weekly Earnings Summary - NUTS',
          html,
          type: 'vendor_weekly_summary',
          metadata: { vendorId: vendor.id, weekStart: weekStartStr },
        });

        await this.rabbitmq.publish(RABBITMQ_QUEUES.NOTIFICATIONS, {
          userId: vendor.id,
          role: ROLE.VENDOR,
          type: NotificationType.SYSTEM_ANNOUNCEMENT,
          title: 'Weekly Performance Report Ready',
          message: `You achieved NGN ${summary.revenue} across ${summary.ordersCount} orders this week!`,
          priority: NotificationPriority.MEDIUM,
          link: '/vendor/analytics',
          metadata: { vendorId: vendor.id, weekStart: weekStartStr },
        });

        // Cache deduplication for 7 days
        await this.redis.set(dedupKey, 'sent', 'EX', 7 * 24 * 60 * 60);
        summariesQueued++;
      }

      this.logger.log(
        {
          summariesQueued,
          activeVendorsFound: vendors.length,
          activityVendorsFound: summaries.size,
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          durationMs: Date.now() - startedAt,
        },
        'Vendor weekly summary cron completed',
      );
    } catch (error) {
      this.logger.error(
        {
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Vendor weekly summary cron failed',
      );

      throw error;
    }
  }
}

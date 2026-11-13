import { Injectable } from '@nestjs/common';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { fillAnalyticsDateGaps } from '@api/common/utils/date-range.util';
import { ActivityAnalyticsDto } from './dto/admin-analytics-summary.dto';

@Injectable()
export class AdminAnalyticsAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async getActivityAnalytics(
    start: Date,
    end: Date,
  ): Promise<ActivityAnalyticsDto> {
    // Single query for total actions + unique admins count
    const [summary] = await this.prisma.$queryRaw<
      Array<{ total_actions: bigint; unique_admins: bigint }>
    >`
      SELECT COUNT(*) AS total_actions,
             COUNT(DISTINCT "adminId") AS unique_admins
      FROM   "audit_logs"
      WHERE  "createdAt" >= ${start}
        AND  "createdAt" <= ${end}
    `;
    const totalActions = Number(summary.total_actions);
    const uniqueAdmins = Number(summary.unique_admins);

    // Action breakdown â€” still efficient with groupBy since we group by enum col, not timestamp
    const actionRows = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: { createdAt: { gte: start, lte: end } },
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
    });
    const actionBreakdown: Record<string, number> = {};
    for (const r of actionRows) {
      actionBreakdown[r.action] = r._count.action ?? 0;
    }

    // Top admins by activity â€” use $queryRaw to JOIN with admins table in one shot
    const topAdminRows = await this.prisma.$queryRaw<
      Array<{
        admin_id: string;
        email: string;
        action_count: bigint;
      }>
    >`
      SELECT al."adminId" AS admin_id,
             a.email,
             COUNT(*) AS action_count
      FROM   "audit_logs" al
      JOIN   "admins" a ON a.id = al."adminId"
      WHERE  al."adminId" IS NOT NULL
        AND  al."createdAt" >= ${start}
        AND  al."createdAt" <= ${end}
      GROUP  BY al."adminId", a.email
      ORDER  BY action_count DESC
      LIMIT  10
    `;

    const topAdmins = topAdminRows.map((r) => ({
      adminId: r.admin_id,
      email: r.email ?? 'Unknown',
      actionCount: Number(r.action_count),
    }));

    // Daily activity trend with DATE_TRUNC for correct bucketing
    const trendRows = await this.prisma.$queryRaw<
      Array<{ date: string; count: bigint }>
    >`
      SELECT TO_CHAR(
               DATE_TRUNC('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Lagos'),
               'YYYY-MM-DD'
             ) AS date,
             COUNT(*) AS count
      FROM   "audit_logs"
      WHERE  "createdAt" >= ${start}
        AND  "createdAt" <= ${end}
      GROUP  BY 1
      ORDER  BY 1 ASC
    `;

    const activityTrend = fillAnalyticsDateGaps(
      trendRows.map((r) => ({
        date: r.date,
        value: Number(r.count ?? 0),
      })),
      start,
      end,
    );

    return {
      totalActions,
      uniqueAdmins,
      actionBreakdown,
      topAdmins,
      activityTrend,
    };
  }
}

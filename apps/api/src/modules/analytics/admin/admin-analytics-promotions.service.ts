import { Injectable } from '@nestjs/common';
import { PaymentStatus, WalletTransactionReason } from '@prisma/client';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import {
  DiscountAnalyticsDto,
  PaymentAnalyticsDto,
  ReferralAnalyticsDto,
} from './dto/admin-analytics-summary.dto';

@Injectable()
export class AdminAnalyticsPromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  // â”€â”€ Discounts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getDiscountAnalytics(
    start: Date,
    end: Date,
  ): Promise<DiscountAnalyticsDto> {
    const usageWhere = { createdAt: { gte: start, lte: end } };
    const [totalCodes, activeCodes, usageAgg, usageGroups] = await Promise.all([
      this.prisma.discountCode.count(),
      this.prisma.discountCode.count({ where: { isActive: true } }),
      this.prisma.discountCodeUsage.aggregate({
        _sum: { discountAmount: true },
        _count: { id: true },
        where: usageWhere,
      }),
      this.prisma.discountCodeUsage.groupBy({
        by: ['discountCodeId'],
        where: usageWhere,
        _sum: { discountAmount: true },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    // Rank codes by exact discount usage captured in the selected calendar window.
    const codes = await this.prisma.discountCode.findMany({
      where: { id: { in: usageGroups.map((group) => group.discountCodeId) } },
      select: { id: true, code: true },
    });
    const codeById = new Map(codes.map((code) => [code.id, code.code]));
    const topCodes = usageGroups.map((group) => ({
      code: codeById.get(group.discountCodeId) ?? 'Deleted code',
      usageCount: group._count.id,
      totalDiscount: Number(group._sum.discountAmount ?? 0).toFixed(2),
    }));

    return {
      totalCodes,
      activeCodes,
      totalUsages: usageAgg._count.id,
      totalDiscountGiven: Number(usageAgg._sum.discountAmount ?? 0).toFixed(2),
      topCodes,
    };
  }

  // â”€â”€ Referrals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getReferralAnalytics(): Promise<ReferralAnalyticsDto> {
    const [totalReferrals, rewardAgg] = await Promise.all([
      this.prisma.referral.count(),
      this.prisma.walletTransaction.aggregate({
        _sum: { amount: true },
        where: { reason: WalletTransactionReason.REFERRAL },
      }),
    ]);

    return {
      totalReferrals,
      referredUsersConverted: totalReferrals,
      totalDiscountGiven: Number(rewardAgg._sum?.amount ?? 0).toFixed(2),
    };
  }

  // â”€â”€ Payments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getPaymentAnalytics(
    start: Date,
    end: Date,
  ): Promise<PaymentAnalyticsDto> {
    const createdAt = { gte: start, lte: end };
    const [totalPayments, successfulPayments, failedPayments, refundedAgg] =
      await Promise.all([
        this.prisma.payment.count({ where: { createdAt } }),
        this.prisma.payment.count({
          where: { status: PaymentStatus.SUCCESS, createdAt },
        }),
        this.prisma.payment.count({
          where: { status: PaymentStatus.FAILED, createdAt },
        }),
        this.prisma.payment.aggregate({
          _sum: { amount: true },
          where: { status: PaymentStatus.REFUNDED, createdAt },
        }),
      ]);

    // Revenue grouped by payment method
    const byMethod = await this.prisma.payment.groupBy({
      by: ['paymentMethod'],
      where: { status: PaymentStatus.SUCCESS, createdAt },
      _sum: { amount: true },
    });
    const revenueByMethod: Record<string, string> = {};
    for (const m of byMethod) {
      const key = m.paymentMethod ?? 'unknown';
      revenueByMethod[key] = Number(m._sum?.amount ?? 0).toFixed(2);
    }

    return {
      totalPayments,
      successfulPayments,
      failedPayments,
      refundedAmount: Number(refundedAgg._sum?.amount ?? 0).toFixed(2),
      revenueByMethod,
      successRate:
        totalPayments > 0
          ? Number(((successfulPayments / totalPayments) * 100).toFixed(1))
          : 0,
    };
  }
}

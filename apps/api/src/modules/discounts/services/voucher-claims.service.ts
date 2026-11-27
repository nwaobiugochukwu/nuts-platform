import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DiscountClaimStatus,
  DiscountCodeType,
  OrderStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '@api/infrastructure/database/prisma.service';

import {
  describeDiscountTargets,
  type DiscountTargets,
} from '../utils/discount-targets.util';

/** How long a claim holds its reservation before it is given back. */
export const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

export interface VoucherClaimView {
  code: string;
  description: string | null;
  type: DiscountCodeType;
  value: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  stackable: boolean;
  firstOrderOnly: boolean;
  scope: string;
  startsAt: Date | null;
  expiresAt: Date;
  claimedAt: Date;
  /**
   * ACTIVE: can be used. USED: the customer has used it the maximum number of times
   * allowed per customer; kept for history, never offered again.
   */
  status: 'ACTIVE' | 'USED';
  usedAt: Date | null;
  /** What the voucher covers (store, specific products, categories). */
  appliesTo: DiscountTargets;
}

/**
 * Server-side voucher claims ("my vouchers").
 *
 * A claim saves a code to the customer's account. For a code with a global
 * usageLimit an ACTIVE, unexpired claim also RESERVES one use for that
 * customer, so two shoppers can never both be promised the last one. The
 * reservation is time-boxed and is handed back on expiry, release, or when the
 * order that used the voucher is cancelled or refunded.
 */
@Injectable()
export class VoucherClaimsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalize(code: string): string {
    return code.trim().toUpperCase();
  }

  /** Number of live reservations held by customers OTHER than `userId`. */
  static async reservedByOthers(
    client: Pick<Prisma.TransactionClient, 'discountCodeClaim'>,
    discountCodeId: string,
    userId: string,
  ): Promise<number> {
    return client.discountCodeClaim.count({
      where: {
        discountCodeId,
        status: DiscountClaimStatus.ACTIVE,
        expiresAt: { gt: new Date() },
        userId: { not: userId },
      },
    });
  }

  async claim(userId: string, rawCode: string): Promise<VoucherClaimView> {
    const code = this.normalize(rawCode);
    if (!code) throw new BadRequestException('A voucher code is required.');

    const result = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent claims of the same code: the capacity check and
      // the insert below must see each other.
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "discount_codes" WHERE "code" = ${code} FOR UPDATE`,
      );
      if (locked.length !== 1) {
        throw new NotFoundException('Invalid or inactive voucher code.');
      }

      const discount = await tx.discountCode.findFirst({
        where: { id: locked[0].id, isActive: true, deletedAt: null },
      });
      if (!discount) {
        throw new NotFoundException('Invalid or inactive voucher code.');
      }

      if (discount.autoApply) {
        throw new BadRequestException(
          'This offer applies automatically when your cart qualifies. There is nothing to claim.',
        );
      }

      const now = new Date();
      if (discount.startsAt && now < discount.startsAt) {
        throw new BadRequestException('This voucher is not active yet.');
      }
      if (discount.expiresAt && now >= discount.expiresAt) {
        throw new BadRequestException('This voucher has expired.');
      }

      if (discount.firstOrderOnly) {
        const prior = await tx.order.count({
          where: { userId, status: { not: OrderStatus.CANCELLED } },
        });
        if (prior > 0) {
          throw new ConflictException(
            'This voucher is exclusively reserved for first-time shoppers.',
          );
        }
      }

      if (discount.perUserUsageLimit !== null) {
        const used = await tx.discountCodeUserUsage.findUnique({
          where: {
            discountCodeId_userId: { discountCodeId: discount.id, userId },
          },
          select: { usageCount: true },
        });
        if (used && used.usageCount >= discount.perUserUsageLimit) {
          throw new ConflictException(
            'You have already used this voucher the maximum number of times.',
          );
        }
      }

      if (discount.usageLimit !== null) {
        const others = await VoucherClaimsService.reservedByOthers(
          tx,
          discount.id,
          userId,
        );
        if (discount.usageCount + others >= discount.usageLimit) {
          throw new ConflictException(
            'All available vouchers of this offer have been claimed.',
          );
        }
      }

      const ttlEnd = new Date(now.getTime() + CLAIM_TTL_MS);
      const expiresAt =
        discount.expiresAt && discount.expiresAt < ttlEnd
          ? discount.expiresAt
          : ttlEnd;

      const claim = await tx.discountCodeClaim.upsert({
        where: {
          discountCodeId_userId: { discountCodeId: discount.id, userId },
        },
        create: {
          discountCodeId: discount.id,
          userId,
          status: DiscountClaimStatus.ACTIVE,
          expiresAt,
        },
        // Re-claiming revives a released/expired/redeemed claim and refreshes
        // the hold; an already-active one is simply extended (idempotent).
        update: {
          status: DiscountClaimStatus.ACTIVE,
          claimedAt: now,
          expiresAt,
          orderId: null,
        },
      });

      return { discount, claim };
    });
    const [appliesTo] = await describeDiscountTargets(this.prisma, [
      result.discount,
    ]);
    return this.toView(
      result.discount,
      result.claim.claimedAt,
      result.claim.expiresAt,
      appliesTo,
    );
  }

  async list(userId: string): Promise<VoucherClaimView[]> {
    const [active, redeemed] = await Promise.all([
      this.prisma.discountCodeClaim.findMany({
        where: {
          userId,
          status: DiscountClaimStatus.ACTIVE,
          expiresAt: { gt: new Date() },
          discountCode: { isActive: true, deletedAt: null },
        },
        include: { discountCode: true },
        orderBy: { claimedAt: 'desc' },
        take: 50,
      }),
      this.prisma.discountCodeClaim.findMany({
        where: {
          userId,
          status: DiscountClaimStatus.REDEEMED,
          discountCode: { perUserUsageLimit: { not: null }, deletedAt: null },
        },
        include: { discountCode: true },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
    ]);

    // Which of these codes has this customer used the maximum number of times?
    const codeIds = [
      ...new Set([...active, ...redeemed].map((c) => c.discountCodeId)),
    ];
    const usages = codeIds.length
      ? await this.prisma.discountCodeUserUsage.findMany({
          where: { userId, discountCodeId: { in: codeIds } },
          select: { discountCodeId: true, usageCount: true },
        })
      : [];
    const usedCount = new Map(
      usages.map((u) => [u.discountCodeId, u.usageCount]),
    );
    const isUsedUp = (claim: (typeof active)[number]) => {
      const limit = claim.discountCode.perUserUsageLimit;
      return (
        limit !== null && (usedCount.get(claim.discountCodeId) ?? 0) >= limit
      );
    };

    const available = active.filter((claim) => !isUsedUp(claim));
    const seen = new Set<string>();
    const used = [...active.filter(isUsedUp), ...redeemed.filter(isUsedUp)]
      .filter((claim) => {
        if (seen.has(claim.discountCodeId)) return false;
        seen.add(claim.discountCodeId);
        return true;
      })
      .slice(0, 30);

    const rows = [...available, ...used];
    const targets = await describeDiscountTargets(
      this.prisma,
      rows.map((c) => c.discountCode),
    );
    return rows.map((c, i) =>
      this.toView(
        c.discountCode,
        c.claimedAt,
        c.expiresAt,
        targets[i],
        i < available.length ? 'ACTIVE' : 'USED',
        i < available.length ? null : c.updatedAt,
      ),
    );
  }

  async release(userId: string, rawCode: string): Promise<null> {
    const code = this.normalize(rawCode);
    // Only an ACTIVE claim can be given up; a redeemed one is history.
    await this.prisma.discountCodeClaim.updateMany({
      where: {
        userId,
        status: DiscountClaimStatus.ACTIVE,
        discountCode: { code },
      },
      data: { status: DiscountClaimStatus.RELEASED },
    });
    return null;
  }

  /** Removes long-dead claim rows (housekeeping; correctness never depends on it). */
  async purgeStale(olderThanDays = 7, batch = 1000): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.discountCodeClaim.findMany({
      where: {
        OR: [
          { expiresAt: { lt: cutoff } },
          { status: DiscountClaimStatus.RELEASED, updatedAt: { lt: cutoff } },
        ],
        status: { not: DiscountClaimStatus.REDEEMED },
      },
      select: { id: true },
      take: batch,
    });
    if (rows.length === 0) return 0;
    const res = await this.prisma.discountCodeClaim.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    return res.count;
  }

  private toView(
    d: {
      code: string;
      description: string | null;
      type: DiscountCodeType;
      value: Prisma.Decimal;
      minOrderAmount: Prisma.Decimal;
      maxDiscountAmount: Prisma.Decimal | null;
      stackable: boolean;
      firstOrderOnly: boolean;
      scope: string;
      startsAt: Date | null;
    },
    claimedAt: Date,
    expiresAt: Date,
    appliesTo: DiscountTargets,
    status: 'ACTIVE' | 'USED' = 'ACTIVE',
    usedAt: Date | null = null,
  ): VoucherClaimView {
    return {
      code: d.code,
      description: d.description,
      type: d.type,
      value: Number(d.value),
      minOrderAmount: Number(d.minOrderAmount),
      maxDiscountAmount:
        d.maxDiscountAmount !== null ? Number(d.maxDiscountAmount) : null,
      stackable: d.stackable,
      firstOrderOnly: d.firstOrderOnly,
      scope: d.scope,
      startsAt: d.startsAt,
      expiresAt,
      claimedAt,
      status,
      usedAt,
      appliesTo,
    };
  }
}

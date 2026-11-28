import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import {
  DiscountClaimStatus,
  DiscountCode,
  DiscountCodeScope,
  DiscountCodeType,
  OrderStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import {
  type DiscountEvaluation,
  type DiscountLineItem,
  MAX_STACKED_VOUCHERS,
  allocateAcrossLines,
  eligibleLineIndexes,
  evaluateEligibleLines,
} from '../utils/discount-eligibility.util';
import {
  describeDiscountTargets,
  isRestrictedDiscount,
  type DiscountTargets,
} from '../utils/discount-targets.util';
import { releaseDiscountUsage } from '../utils/discount-funding.util';
import { normalizeDiscountCode } from '../utils/discount-code.util';
import { isFirstOrderOnlyDiscount } from '../utils/first-order.util';
import { VoucherClaimsService } from './voucher-claims.service';

/**
 * Redeeming discount codes: working out which codes apply to a cart (the stack of vouchers and the
 * automatic discounts), checking one code, and recording and releasing its use on an order. Creating
 * and maintaining codes is `DiscountCodeManagementService`; what the storefront shows about offers is
 * `PublicPromotionsService`.
 */
@Injectable()
export class DiscountCodeService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  /** What each code covers, keyed by code, for cart/wallet messaging. */
  async describeTargetsByCode(
    rawCodes: string[],
  ): Promise<Map<string, DiscountTargets>> {
    const codes = [...new Set(rawCodes.map((c) => normalizeDiscountCode(c)))];
    if (codes.length === 0) return new Map();
    const rows = await this.prisma.discountCode.findMany({
      where: { code: { in: codes } },
    });
    const targets = await describeDiscountTargets(this.prisma, rows);
    return new Map(rows.map((row, i) => [row.code, targets[i]]));
  }

  /**
   * Validates ONE code against the cart's eligible lines. Same engine as
   * `resolveVoucherStack`, so single and combined vouchers can never disagree.
   */
  async validateForCart(
    rawCode: string,
    userId: string,
    lines: DiscountLineItem[],
  ): Promise<{
    discount: DiscountCode;
    evaluation: DiscountEvaluation;
    discountAmount: Prisma.Decimal;
  }> {
    const stack = await this.resolveVoucherStack([rawCode], userId, lines, {
      strict: true,
    });
    return stack.applied[0];
  }

  /**
   * Resolves up to two vouchers for a cart.
   *
   * Rules:
   *  - Combining needs every code to be `stackable`, and at most one store
   *    voucher plus one platform voucher.
   *  - Store voucher applies first, on its own items; the platform voucher then
   *    discounts only what is still left, so total discount never exceeds the
   *    goods total and each code's funding stays attributable.
   *  - Minimum spend is measured on the code's eligible items BEFORE other
   *    vouchers; the amount is computed on what remains.
   *
   * `strict` (checkout): the first problem is thrown, so an order is never
   * placed with a voucher the shopper did not see applied. Non-strict
   * (cart preview): problems are returned per code so the UI can say which
   * voucher was dropped and why, while the valid ones still apply.
   */
  async resolveVoucherStack(
    rawCodes: string[],
    userId: string,
    lines: DiscountLineItem[],
    {
      strict,
      includeAutomatic = false,
    }: { strict: boolean; includeAutomatic?: boolean },
  ): Promise<{
    applied: Array<{
      discount: DiscountCode;
      evaluation: DiscountEvaluation;
      discountAmount: Prisma.Decimal;
    }>;
    rejected: Array<{ code: string; error: Error }>;
    totalDiscount: Prisma.Decimal;
  }> {
    const codes = [
      ...new Set(rawCodes.map((c) => normalizeDiscountCode(c)).filter(Boolean)),
    ];
    const rejected: Array<{ code: string; error: Error }> = [];
    const fail = (code: string, error: Error) => {
      if (strict) throw error;
      rejected.push({ code, error });
    };

    if (codes.length > MAX_STACKED_VOUCHERS) {
      const overflow = new BadRequestException(
        `You can apply at most ${MAX_STACKED_VOUCHERS} vouchers to one order.`,
      );
      if (strict) throw overflow;
      for (const code of codes.slice(MAX_STACKED_VOUCHERS)) {
        rejected.push({ code, error: overflow });
      }
      codes.length = MAX_STACKED_VOUCHERS;
    }

    // 1. Each code must be usable by this shopper on its own.
    const usable: DiscountCode[] = [];
    for (const code of codes) {
      try {
        const discount = await this.validate(code, userId);
        if (discount.autoApply) {
          // Automatic offers are never entered or claimed; the engine applies
          // them itself when the cart qualifies.
          fail(
            code,
            new BadRequestException(
              'This offer applies automatically when your cart qualifies. No code is needed.',
            ),
          );
          continue;
        }
        usable.push(discount);
      } catch (error) {
        fail(code, error as Error);
      }
    }

    const userStack = this.evaluateStack(usable, lines, fail);
    if (!includeAutomatic) return { ...userStack, rejected };
    return this.preferBestWithAutomatic(
      usable,
      userStack,
      userId,
      lines,
      rejected,
    );
  }

  /**
   * Combination rules + amounts for an already-validated list of discounts.
   * Pure with respect to the database; problems are reported through `fail`.
   */
  private evaluateStack(
    usable: DiscountCode[],
    lines: DiscountLineItem[],
    fail: (code: string, error: Error) => void,
  ): {
    applied: Array<{
      discount: DiscountCode;
      evaluation: DiscountEvaluation;
      discountAmount: Prisma.Decimal;
    }>;
    totalDiscount: Prisma.Decimal;
  } {
    // 2. Combination rules (the first usable code is the anchor).
    const combined: DiscountCode[] = [];
    for (const candidate of usable) {
      const anchor = combined[0];
      if (!anchor) {
        combined.push(candidate);
        continue;
      }
      if (!anchor.stackable || !candidate.stackable) {
        const exclusive = !anchor.stackable ? anchor : candidate;
        fail(
          candidate.code,
          new BadRequestException(
            `${exclusive.code} can't be combined with other vouchers.`,
          ),
        );
      } else if (anchor.scope === candidate.scope) {
        fail(
          candidate.code,
          new BadRequestException(
            `${anchor.code} and ${candidate.code} are both ${anchor.scope === DiscountCodeScope.VENDOR ? 'store' : 'platform'} vouchers. You can combine one store voucher with one platform voucher.`,
          ),
        );
      } else {
        combined.push(candidate);
      }
    }

    // 3. Store voucher first, then platform, each on what is still unpaid.
    combined.sort(
      (a, b) =>
        Number(b.scope === DiscountCodeScope.VENDOR) -
        Number(a.scope === DiscountCodeScope.VENDOR),
    );

    const remaining = lines.map((line) => line.lineTotal);
    const applied: Array<{
      discount: DiscountCode;
      evaluation: DiscountEvaluation;
      discountAmount: Prisma.Decimal;
    }> = [];
    let totalDiscount = new Prisma.Decimal(0);

    for (const discount of combined) {
      const evaluation = evaluateEligibleLines(discount, lines);

      if (evaluation.eligibleSubtotal.lessThanOrEqualTo(0)) {
        fail(
          discount.code,
          new BadRequestException(
            isRestrictedDiscount(discount)
              ? 'This voucher only applies to specific items, and none of them are in your cart.'
              : discount.scope === DiscountCodeScope.VENDOR
                ? 'This voucher only applies to products from the store that issued it, and none are in your cart.'
                : 'This voucher does not apply to any items in your cart.',
          ),
        );
        continue;
      }

      if (evaluation.eligibleSubtotal.lessThan(discount.minOrderAmount)) {
        const shortfall = new Prisma.Decimal(discount.minOrderAmount)
          .sub(evaluation.eligibleSubtotal)
          .toFixed(2);
        fail(
          discount.code,
          new BadRequestException(
            `Add ${shortfall} more of eligible items to use this discount (minimum ${discount.minOrderAmount.toFixed(2)}).`,
          ),
        );
        continue;
      }

      const eligibleQuantity = eligibleLineIndexes(discount, lines).reduce(
        (sum, i) => sum + (lines[i].quantity ?? 1),
        0,
      );
      if (
        discount.minQuantity !== null &&
        discount.minQuantity !== undefined &&
        eligibleQuantity < discount.minQuantity
      ) {
        const missing = discount.minQuantity - eligibleQuantity;
        fail(
          discount.code,
          new BadRequestException(
            `Add ${missing} more eligible ${missing === 1 ? 'item' : 'items'} to get this offer (minimum ${discount.minQuantity}).`,
          ),
        );
        continue;
      }

      const indexes = eligibleLineIndexes(discount, lines);
      const eligibleRemaining = indexes.reduce(
        (sum, i) => sum.add(remaining[i]),
        new Prisma.Decimal(0),
      );
      if (eligibleRemaining.lessThanOrEqualTo(0)) {
        fail(
          discount.code,
          new BadRequestException(
            'Nothing is left for this voucher to discount after your other voucher.',
          ),
        );
        continue;
      }

      // Minimum spend was checked on the original eligible subtotal above, so
      // compute the amount on what remains without re-applying the minimum.
      const discountAmount = this.calculateDiscount(
        { ...discount, minOrderAmount: new Prisma.Decimal(0) },
        eligibleRemaining,
      );
      allocateAcrossLines(remaining, indexes, discountAmount);
      totalDiscount = totalDiscount.add(discountAmount);
      applied.push({ discount, evaluation, discountAmount });
    }

    return { applied, totalDiscount: totalDiscount.toDecimalPlaces(2) };
  }

  /**
   * Automatic discounts: applied when the cart qualifies, with no code and no
   * claim. They compete with the shopper's own vouchers and the shopper always
   * gets the better outcome:
   *
   *   A  the shopper's vouchers alone
   *   B  the best automatic offer(s) alone
   *   C  vouchers + automatic offers (only if every one is combinable)
   *
   * Ties keep the shopper's explicit choice. A voucher that loses to a better
   * automatic offer is reported (not an error) so the cart can say so.
   */
  private async preferBestWithAutomatic(
    usable: DiscountCode[],
    userStack: ReturnType<DiscountCodeService['evaluateStack']>,
    userId: string,
    lines: DiscountLineItem[],
    rejected: Array<{ code: string; error: Error }>,
  ): Promise<{
    applied: ReturnType<DiscountCodeService['evaluateStack']>['applied'];
    rejected: Array<{ code: string; error: Error }>;
    totalDiscount: Prisma.Decimal;
  }> {
    const silent = () => undefined;
    const autos = await this.findApplicableAutomatic(userId, lines);
    if (autos.length === 0) return { ...userStack, rejected };

    const autoOnly = this.evaluateStack(autos, lines, silent);
    const combined =
      usable.length > 0
        ? this.evaluateStack([...usable, ...autos], lines, silent)
        : autoOnly;

    let best = userStack;
    for (const candidate of [combined, autoOnly]) {
      if (candidate.totalDiscount.greaterThan(best.totalDiscount)) {
        best = candidate;
      }
    }

    if (best !== userStack) {
      const kept = new Set(best.applied.map(({ discount }) => discount.code));
      for (const discount of usable) {
        if (kept.has(discount.code)) continue;
        if (rejected.some(({ code }) => code === discount.code)) continue;
        rejected.push({
          code: discount.code,
          error: new BadRequestException(
            `A better automatic offer is already applied, so ${discount.code} was not used.`,
          ),
        });
      }
    }
    return { ...best, rejected };
  }

  /**
   * Automatic discounts this shopper could get on this cart right now, best
   * saving first. Eligibility (first-order, per-user limits, usage limits,
   * dates) uses the same `validate` as codes; amounts use the shared engine.
   */
  private async findApplicableAutomatic(
    userId: string,
    lines: DiscountLineItem[],
  ): Promise<DiscountCode[]> {
    if (lines.length === 0) return [];

    // Most carts are previewed when no automatic discount exists at all: answer
    // that from a 60s cache (purged on any discount change) instead of querying
    // and validating on every cart edit.
    if (this.cacheService) {
      const anyAutomatic = await this.cacheService.wrap(
        'discounts:auto:any',
        60,
        async () =>
          (await this.prisma.discountCode.count({
            where: { autoApply: true, isActive: true, deletedAt: null },
          })) > 0,
      );
      if (!anyAutomatic) return [];
    }

    const now = new Date();
    const vendorIds = [...new Set(lines.map((line) => line.vendorId))];
    const rows = await this.prisma.discountCode.findMany({
      where: {
        autoApply: true,
        isActive: true,
        deletedAt: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
        OR: [
          { scope: DiscountCodeScope.PLATFORM },
          { vendorId: { in: vendorIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    const checked = await Promise.all(
      rows
        .filter(
          (row) => row.usageLimit === null || row.usageCount < row.usageLimit,
        )
        .map(async (row) => {
          try {
            return await this.validate(row.code, userId);
          } catch {
            return null;
          }
        }),
    );

    return checked
      .filter((discount): discount is DiscountCode => discount !== null)
      .map((discount) => ({
        discount,
        amount: this.evaluateStack([discount], lines, () => undefined)
          .totalDiscount,
      }))
      .filter(({ amount }) => amount.greaterThan(0))
      .sort((a, b) => b.amount.comparedTo(a.amount))
      .map(({ discount }) => discount);
  }

  /**
   * Checks that a code exists and is usable by this user right now. When
   * `orderAmount` is given it is also checked against the minimum order
   * amount; cart-aware callers should use `validateForCart` instead so the
   * minimum is measured on eligible items only.
   */
  async validate(
    rawCode: string,
    userId: string,
    orderAmount?: Prisma.Decimal,
  ): Promise<DiscountCode> {
    const code = normalizeDiscountCode(rawCode);

    if (!code) {
      throw new BadRequestException('Discount code is required.');
    }

    const discount = await this.prisma.discountCode.findFirst({
      where: {
        code,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!discount) {
      throw new NotFoundException('Invalid or inactive discount code.');
    }

    const now = new Date();

    if (discount.startsAt !== null && now < discount.startsAt) {
      throw new BadRequestException('This discount code is not active yet.');
    }

    if (discount.expiresAt !== null && now > discount.expiresAt) {
      throw new BadRequestException('This discount code has expired.');
    }

    /**
     * This is only an early validation check.
     *
     * The final usage-limit check happens again inside
     * recordUsage() while holding a database row lock.
     *
     * This is important because another checkout could redeem
     * the final available slot after this validation succeeds.
     */
    // Live reservations held by OTHER customers count against the limit, so
    // two shoppers can't both be promised the last use. The caller's own claim
    // holds a slot for them and is therefore not counted against them.
    if (discount.usageLimit !== null) {
      const reservedByOthers = await VoucherClaimsService.reservedByOthers(
        this.prisma,
        discount.id,
        userId,
      );
      if (discount.usageCount + reservedByOthers >= discount.usageLimit) {
        throw new ConflictException(
          'This discount code has reached its usage limit.',
        );
      }
    }

    if (orderAmount && orderAmount.lessThan(discount.minOrderAmount)) {
      throw new BadRequestException(
        `Minimum order amount for this discount is ${discount.minOrderAmount.toFixed(2)}.`,
      );
    }

    /**
     * Check the customer's individual redemption count.
     *
     * We don't create a counter row unnecessarily if the
     * customer has never used this code.
     */
    if (discount.perUserUsageLimit !== null) {
      const userUsage = await this.prisma.discountCodeUserUsage.findUnique({
        where: {
          discountCodeId_userId: {
            discountCodeId: discount.id,
            userId,
          },
        },
        select: {
          usageCount: true,
        },
      });

      if (userUsage && userUsage.usageCount >= discount.perUserUsageLimit) {
        throw new ConflictException(
          'You have reached the usage limit for this discount code.',
        );
      }
    }

    /**
     * Check first-time buyer restriction.
     * If the discount is designated for first-time shoppers,
     * the customer must not have any prior non-cancelled orders.
     */
    if (isFirstOrderOnlyDiscount(discount)) {
      const priorOrdersCount = await this.prisma.order.count({
        where: {
          userId,
          status: {
            not: OrderStatus.CANCELLED,
          },
        },
      });

      if (priorOrdersCount > 0) {
        throw new ConflictException(
          'This discount is exclusively reserved for first-time shoppers on their first purchase.',
        );
      }
    }

    return discount;
  }

  // ============================================================
  // RECORD USAGE
  // ============================================================

  /**
   * Record a successful discount redemption.
   *
   * IMPORTANT:
   * This method MUST run inside the same transaction as checkout.
   *
   * The DiscountCode row is locked using SELECT ... FOR UPDATE.
   *
   * That makes the usage-limit check + increment atomic and
   * prevents two concurrent checkouts from both consuming
   * the final available redemption.
   */
  async recordUsage(
    discountCodeId: string,
    orderId: string,
    userId: string,
    discountAmount: Prisma.Decimal,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // ----------------------------------------------------------
    // 1. Lock the discount code row.
    // ----------------------------------------------------------

    const discountRows = await tx.$queryRaw<
      Array<{
        id: string;
        usageLimit: number | null;
        usageCount: number;
        perUserUsageLimit: number | null;
        isActive: boolean;
        deletedAt: Date | null;
        startsAt: Date | null;
        expiresAt: Date | null;
        firstOrderOnly: boolean | null;
      }>
    >(
      Prisma.sql`
        SELECT
          "id",
          "usageLimit",
          "usageCount",
          "perUserUsageLimit",
          "isActive",
          "deletedAt",
          "startsAt",
          "expiresAt",
          "firstOrderOnly"
        FROM "discount_codes"
        WHERE "id" = ${discountCodeId}
        FOR UPDATE
      `,
    );

    if (discountRows.length !== 1) {
      throw new NotFoundException('Discount code not found.');
    }

    const discount = discountRows[0];

    // ----------------------------------------------------------
    // 2. Verify the code is still usable.
    // ----------------------------------------------------------

    if (!discount.isActive || discount.deletedAt !== null) {
      throw new BadRequestException('This discount code is no longer active.');
    }

    const now = new Date();

    if (discount.startsAt !== null && now < discount.startsAt) {
      throw new BadRequestException('This discount code is not active yet.');
    }

    if (discount.expiresAt !== null && now > discount.expiresAt) {
      throw new BadRequestException('This discount code has expired.');
    }

    // ----------------------------------------------------------
    // 3. Idempotency protection.
    // ----------------------------------------------------------
    //
    // If the same order tries to record this discount twice,
    // don't increment the counters twice.
    //
    // The database unique constraint is the final protection.
    // ----------------------------------------------------------

    const existingUsage = await tx.discountCodeUsage.findUnique({
      where: {
        discountCodeId_userId_orderId: {
          discountCodeId,
          userId,
          orderId,
        },
      },

      select: {
        id: true,
      },
    });

    if (existingUsage) {
      return;
    }

    // The first-order rule is re-checked inside the locked transaction:
    // `validate()` ran earlier, so two simultaneous checkouts by a brand-new
    // shopper could otherwise both pass it. The code row lock serialises them.
    if (discount.firstOrderOnly) {
      const priorOrders = await tx.order.count({
        where: {
          userId,
          id: { not: orderId },
          status: { not: OrderStatus.CANCELLED },
        },
      });
      if (priorOrders > 0) {
        throw new ConflictException(
          'This discount is exclusively reserved for first-time shoppers on their first purchase.',
        );
      }
    }

    // ----------------------------------------------------------
    // 4. Check global usage limit.
    // ----------------------------------------------------------

    if (discount.usageLimit !== null) {
      const reservedByOthers = await VoucherClaimsService.reservedByOthers(
        tx,
        discountCodeId,
        userId,
      );
      if (discount.usageCount + reservedByOthers >= discount.usageLimit) {
        throw new ConflictException(
          'This discount code has reached its usage limit.',
        );
      }
    }

    // ----------------------------------------------------------
    // 5. Load the user's usage counter.
    // ----------------------------------------------------------

    const userUsage = await tx.discountCodeUserUsage.findUnique({
      where: {
        discountCodeId_userId: {
          discountCodeId,
          userId,
        },
      },

      select: {
        id: true,
        usageCount: true,
      },
    });

    // ----------------------------------------------------------
    // 6. Check per-user usage limit.
    // ----------------------------------------------------------

    if (
      discount.perUserUsageLimit !== null &&
      userUsage &&
      userUsage.usageCount >= discount.perUserUsageLimit
    ) {
      throw new ConflictException(
        'You have reached the usage limit for this discount code.',
      );
    }

    // ----------------------------------------------------------
    // 7. Create immutable usage history.
    // ----------------------------------------------------------
    //
    // discountAmount is stored as a snapshot because the
    // discount itself may later be edited.
    // ----------------------------------------------------------

    await tx.discountCodeUsage.create({
      data: {
        discountCodeId,
        orderId,
        userId,

        discountAmount: discountAmount.toDecimalPlaces(2),
      },
    });

    // The customer's reservation (if any) is now consumed by this order.
    await tx.discountCodeClaim.updateMany({
      where: {
        discountCodeId,
        userId,
        status: DiscountClaimStatus.ACTIVE,
      },
      data: { status: DiscountClaimStatus.REDEEMED, orderId },
    });

    // ----------------------------------------------------------
    // 8. Increment global usage count.
    // ----------------------------------------------------------

    await tx.discountCode.update({
      where: {
        id: discountCodeId,
      },

      data: {
        usageCount: {
          increment: 1,
        },
      },
    });

    // ----------------------------------------------------------
    // 9. Increment/create per-user counter.
    // ----------------------------------------------------------

    if (!userUsage) {
      await tx.discountCodeUserUsage.create({
        data: {
          discountCodeId,
          userId,
          usageCount: 1,
        },
      });
    } else {
      await tx.discountCodeUserUsage.update({
        where: {
          id: userUsage.id,
        },

        data: {
          usageCount: {
            increment: 1,
          },
        },
      });
    }
  }

  // ============================================================
  // RELEASE USAGE
  // ============================================================

  /**
   * Give a redemption back when its order will never be paid: cancelled,
   * expired unpaid, payment failed, or refunded.
   *
   * Without this, abandoned checkouts permanently burn a code's global limit
   * and the shopper's own per-user allowance.
   *
   * Idempotent: the usage row is the idempotency key, so calling it twice for
   * the same order releases it once. Must run inside the same transaction as
   * the order status change.
   */
  async releaseUsage(
    orderId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await releaseDiscountUsage(tx, orderId);
  }

  // ============================================================
  // SOFT DELETE
  // ============================================================

  /**
   * Never physically delete a discount code that may have
   * financial/order history attached to it.
   *
   * We deactivate it and retain the record for auditing.
   */
  // ============================================================
  // SOFT DELETE / DEACTIVATE
  // ============================================================

  calculateDiscount(
    discountCode: {
      type: DiscountCodeType;
      value: Prisma.Decimal | number;
      maxDiscountAmount?: Prisma.Decimal | number | null;
      minOrderAmount?: Prisma.Decimal | number;
    },
    orderAmount: Prisma.Decimal | number,
  ): Prisma.Decimal {
    const amount = new Prisma.Decimal(orderAmount);
    const value = new Prisma.Decimal(discountCode.value);

    if (discountCode.minOrderAmount) {
      const minOrder = new Prisma.Decimal(discountCode.minOrderAmount);
      if (amount.lessThan(minOrder)) {
        return new Prisma.Decimal(0);
      }
    }

    let discount: Prisma.Decimal;
    if (discountCode.type === DiscountCodeType.PERCENTAGE) {
      discount = amount.mul(value).div(100);
      if (
        discountCode.maxDiscountAmount !== null &&
        discountCode.maxDiscountAmount !== undefined
      ) {
        const max = new Prisma.Decimal(discountCode.maxDiscountAmount);
        if (discount.greaterThan(max)) {
          discount = max;
        }
      }
    } else {
      discount = value;
    }

    if (discount.greaterThan(amount)) {
      discount = amount;
    }

    return discount.toDecimalPlaces(2);
  }
}

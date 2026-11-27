import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
import { randomBytes } from 'node:crypto';
import { AuditLogService } from '@api/modules/audit/services/audit-log.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import {
  DISCOUNT_CODE_PATTERN,
  VENDOR_MAX_DISCOUNT_PERCENT,
} from '@api/common/constants/discount.constants';
import {
  type DiscountEvaluation,
  type DiscountLineItem,
  MAX_STACKED_VOUCHERS,
  allocateAcrossLines,
  eligibleLineIndexes,
  evaluateEligibleLines,
  isProductEligible,
} from './discount-eligibility';
import {
  describeDiscountTargets,
  isRestrictedDiscount,
  type DiscountTargets,
} from './discount-targets';
import { releaseDiscountUsage } from './discount-funding';
import { VoucherClaimsService } from './voucher-claims.service';

import {
  BatchProductDiscountsDto,
  CreateAdminDiscountCodeDto,
  CreateDiscountCodeDto,
  CreateVendorDiscountCodeDto,
  DiscountCodeResponseDto,
  ProductVoucherSummaryDto,
  PublicPlatformPromoDto,
  PublicProductDealDto,
  UpdateAdminDiscountCodeDto,
  UpdateDiscountCodeDto,
  UpdateVendorDiscountCodeDto,
} from './dto';

@Injectable()
export class DiscountCodeService {
  private readonly logger = new Logger(DiscountCodeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  // ============================================================
  // CODE NORMALIZATION
  // ============================================================

  /**
   * Discount codes are case-insensitive.
   *
   * Storing one canonical representation prevents:
   *
   * SAVE10
   * save10
   * Save10
   *
   * from being treated as different codes.
   */
  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /**
   * Identifies campaigns and coupons that are explicitly reserved
   * for first-time shoppers who have never placed an order before.
   */
  private isFirstOrderOnlyDiscount(discount: {
    firstOrderOnly?: boolean;
  }): boolean {
    return discount.firstOrderOnly === true;
  }

  private async hasPriorNonCancelledOrders(userId?: string): Promise<boolean> {
    if (!userId) return false;
    if (this.cacheService) {
      return this.cacheService.wrap(
        `user:has-prior-orders:${userId}`,
        300,
        async () => {
          const count = await this.prisma.order.count({
            where: {
              userId,
              status: { not: OrderStatus.CANCELLED },
            },
          });
          return count > 0;
        },
      );
    }
    const count = await this.prisma.order.count({
      where: {
        userId,
        status: { not: OrderStatus.CANCELLED },
      },
    });
    return count > 0;
  }

  // ============================================================
  // VALIDATION HELPERS
  // ============================================================

  /**
   * Validate usage limits before writing them to the database.
   *
   * null = unlimited
   *
   * We intentionally do NOT treat 0 as unlimited.
   * A configured limit must be a positive integer.
   */
  private validateUsageLimits(
    usageLimit: number | null | undefined,
    perUserUsageLimit: number | null | undefined,
  ): void {
    if (
      usageLimit !== null &&
      usageLimit !== undefined &&
      (!Number.isInteger(usageLimit) || usageLimit < 1)
    ) {
      throw new BadRequestException(
        'usageLimit must be a positive integer or null.',
      );
    }

    if (
      perUserUsageLimit !== null &&
      perUserUsageLimit !== undefined &&
      (!Number.isInteger(perUserUsageLimit) || perUserUsageLimit < 1)
    ) {
      throw new BadRequestException(
        'perUserUsageLimit must be a positive integer or null.',
      );
    }

    /**
     * A user's limit cannot logically exceed the global limit.
     *
     * Example:
     *
     * usageLimit = 10
     * perUserUsageLimit = 20
     *
     * is impossible to satisfy for a single user because the
     * entire code can only ever be redeemed 10 times.
     */
    if (
      usageLimit != null &&
      perUserUsageLimit != null &&
      perUserUsageLimit > usageLimit
    ) {
      throw new BadRequestException(
        'perUserUsageLimit cannot be greater than usageLimit.',
      );
    }
  }

  /**
   * Validate discount percentage/fixed amount.
   */
  private validateDiscountValue(
    type: DiscountCodeType,
    value: Prisma.Decimal | number | string,
  ): void {
    const decimalValue = new Prisma.Decimal(value);

    if (decimalValue.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'Discount value must be greater than zero.',
      );
    }

    if (type === DiscountCodeType.PERCENTAGE && decimalValue.greaterThan(100)) {
      throw new BadRequestException('Percentage discount cannot exceed 100%.');
    }
  }

  /** A code must be a sane, enumerable-safe token. */
  private assertValidCodeFormat(code: string): void {
    if (!DISCOUNT_CODE_PATTERN.test(code)) {
      throw new BadRequestException(
        'Discount code must be 3-50 characters using only letters, numbers, hyphens and underscores.',
      );
    }
  }

  private assertValidWindow(
    startsAt: Date | null | undefined,
    expiresAt: Date | null | undefined,
    { allowPastExpiry }: { allowPastExpiry: boolean },
  ): void {
    if (startsAt && expiresAt && expiresAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException(
        'Discount expiry must be after its start date.',
      );
    }
    if (!allowPastExpiry && expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Discount expiry must be in the future.');
    }
  }

  /**
   * Vendors may not give away more than VENDOR_MAX_DISCOUNT_PERCENT, and a
   * vendor code is only ever allowed to target that vendor's own catalogue.
   */
  private async assertVendorRules(
    vendorId: string,
    next: {
      type: DiscountCodeType;
      value: Prisma.Decimal;
      applicableProductIds: string[];
      applicableCategoryIds: string[];
    },
  ): Promise<void> {
    if (
      next.type === DiscountCodeType.PERCENTAGE &&
      next.value.greaterThan(VENDOR_MAX_DISCOUNT_PERCENT)
    ) {
      throw new BadRequestException(
        `Vendor discounts cannot exceed ${VENDOR_MAX_DISCOUNT_PERCENT}%.`,
      );
    }

    if (next.applicableProductIds.length > 0) {
      const owned = await this.prisma.product.count({
        where: {
          id: { in: next.applicableProductIds },
          vendorId,
          isDeleted: false,
        },
      });
      if (owned !== new Set(next.applicableProductIds).size) {
        throw new BadRequestException(
          'You can only create discounts for your own products.',
        );
      }
    }

    if (next.applicableCategoryIds.length > 0) {
      const found = await this.prisma.category.count({
        where: { id: { in: next.applicableCategoryIds } },
      });
      if (found !== new Set(next.applicableCategoryIds).size) {
        throw new BadRequestException('One or more categories do not exist.');
      }
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  /** Internal identifier for an automatic discount (never typed by shoppers). */
  private async generateAutoCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = `AUTO-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
      const taken = await this.prisma.discountCode.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new ConflictException('Could not generate a unique offer id; retry.');
  }

  /** What each code covers, keyed by code, for cart/wallet messaging. */
  async describeTargetsByCode(
    rawCodes: string[],
  ): Promise<Map<string, DiscountTargets>> {
    const codes = [...new Set(rawCodes.map((c) => this.normalizeCode(c)))];
    if (codes.length === 0) return new Map();
    const rows = await this.prisma.discountCode.findMany({
      where: { code: { in: codes } },
    });
    const targets = await describeDiscountTargets(this.prisma, rows);
    return new Map(rows.map((row, i) => [row.code, targets[i]]));
  }

  private async purgeDiscountCache(): Promise<void> {
    if (!this.cacheService) return;
    try {
      await Promise.all([
        this.cacheService.del('discounts:platform-promos:v3'),
        this.cacheService.delByPattern('discounts:*'),
      ]);
    } catch (err) {
      this.logger.warn(
        `Failed to purge discount cache: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ============================================================
  // CREATE
  // ============================================================

  async create(
    dto: CreateDiscountCodeDto,
    vendorId?: string,
  ): Promise<DiscountCode> {
    const isAuto = dto.autoApply === true;
    if (isAuto && (dto.description ?? '').trim().length < 3) {
      throw new BadRequestException(
        'Name your automatic offer (for example "10% off 3 or more items"); shoppers see this name.',
      );
    }
    const code = dto.code
      ? this.normalizeCode(dto.code)
      : isAuto
        ? await this.generateAutoCode()
        : '';
    if (!code) {
      throw new BadRequestException(
        'A discount code is required unless the discount applies automatically.',
      );
    }
    this.assertValidCodeFormat(code);

    this.validateUsageLimits(dto.usageLimit, dto.perUserUsageLimit);

    this.validateDiscountValue(dto.type, dto.value);
    this.assertValidWindow(
      dto.startsAt ? new Date(dto.startsAt) : null,
      dto.expiresAt ? new Date(dto.expiresAt) : null,
      { allowPastExpiry: false },
    );

    if (
      dto.minOrderAmount !== undefined &&
      new Prisma.Decimal(dto.minOrderAmount).lessThan(0)
    ) {
      throw new BadRequestException('Minimum order amount cannot be negative.');
    }

    if (
      dto.maxDiscountAmount !== undefined &&
      dto.maxDiscountAmount !== null &&
      new Prisma.Decimal(dto.maxDiscountAmount).lessThanOrEqualTo(0)
    ) {
      throw new BadRequestException(
        'Maximum discount amount must be greater than zero.',
      );
    }

    /**
     * The database unique constraint is the final protection
     * against duplicate codes.
     *
     * This pre-check simply gives the client a cleaner error.
     */
    const existingCode = await this.prisma.discountCode.findUnique({
      where: { code },
      select: { id: true },
    });

    if (existingCode) {
      throw new ConflictException(
        'A discount code with this code already exists.',
      );
    }

    const isVendorCode = vendorId !== undefined;

    /**
     * Platform-wide codes are created by admins.
     * Vendor codes belong to a vendor.
     */
    const scope = isVendorCode
      ? DiscountCodeScope.VENDOR
      : DiscountCodeScope.PLATFORM;

    const applicableProductIds = [...new Set(dto.applicableProductIds ?? [])];
    const applicableCategoryIds = [...new Set(dto.applicableCategoryIds ?? [])];

    if (vendorId !== undefined) {
      await this.assertVendorRules(vendorId, {
        type: dto.type,
        value: new Prisma.Decimal(dto.value),
        applicableProductIds,
        applicableCategoryIds,
      });
    }

    let created: DiscountCode;
    try {
      created = await this.prisma.discountCode.create({
        data: {
          code,

          description: dto.description?.trim() || null,

          type: dto.type,

          value: new Prisma.Decimal(dto.value),

          maxDiscountAmount:
            dto.maxDiscountAmount !== undefined &&
            dto.maxDiscountAmount !== null
              ? new Prisma.Decimal(dto.maxDiscountAmount)
              : null,

          minOrderAmount:
            dto.minOrderAmount !== undefined
              ? new Prisma.Decimal(dto.minOrderAmount)
              : new Prisma.Decimal(0),

          usageLimit: dto.usageLimit ?? null,

          // New discount codes have not been redeemed yet.
          usageCount: 0,

          perUserUsageLimit: dto.perUserUsageLimit ?? null,

          isActive: dto.isActive ?? true,

          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,

          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,

          vendorId: vendorId ?? null,

          applicableProductIds,
          applicableCategoryIds,

          /**
           * Empty product & category lists mean the vendor's or platform's discount
           * applies to all products within its scope.
           */
          // Vendors cannot opt into platform-wide behaviour; for them
          // "platformwide" just means "all of my own products".
          platformwide:
            vendorId !== undefined
              ? applicableProductIds.length === 0 &&
                applicableCategoryIds.length === 0
              : (dto.platformwide ??
                (applicableProductIds.length === 0 &&
                  applicableCategoryIds.length === 0)),

          firstOrderOnly: dto.firstOrderOnly ?? false,

          stackable: dto.stackable ?? false,

          autoApply: isAuto,
          minQuantity: dto.minQuantity ?? null,

          scope,
        },
      });
    } catch (error) {
      // Two concurrent creates can both pass the pre-check above; the unique
      // index is the real guard, so translate its violation into a clean 409.
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'A discount code with this code already exists.',
        );
      }
      throw error;
    }

    await this.purgeDiscountCache();
    return created;
  }

  // ============================================================
  // UPDATE
  // ============================================================

  async update(
    discountCodeId: string,
    dto: UpdateDiscountCodeDto,
    vendorId?: string,
  ): Promise<DiscountCode> {
    const existing = await this.prisma.discountCode.findUnique({
      where: { id: discountCodeId },
    });

    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Discount code not found.');
    }

    // ---- Resolve the FINAL state, then validate that combined state. ----
    // Validating only the fields present in the request lets a partial update
    // (e.g. just `value`) slip an invalid combination past the checks.
    const nextType = dto.type ?? existing.type;
    const nextValue =
      dto.value !== undefined ? new Prisma.Decimal(dto.value) : existing.value;
    const nextMin =
      dto.minOrderAmount !== undefined
        ? new Prisma.Decimal(dto.minOrderAmount)
        : existing.minOrderAmount;
    const nextMax =
      dto.maxDiscountAmount !== undefined
        ? dto.maxDiscountAmount === null
          ? null
          : new Prisma.Decimal(dto.maxDiscountAmount)
        : existing.maxDiscountAmount;
    const nextUsageLimit =
      dto.usageLimit !== undefined ? dto.usageLimit : existing.usageLimit;
    const nextPerUserUsageLimit =
      dto.perUserUsageLimit !== undefined
        ? dto.perUserUsageLimit
        : existing.perUserUsageLimit;
    const nextStartsAt =
      dto.startsAt !== undefined
        ? dto.startsAt
          ? new Date(dto.startsAt)
          : null
        : existing.startsAt;
    const nextExpiresAt =
      dto.expiresAt !== undefined
        ? dto.expiresAt
          ? new Date(dto.expiresAt)
          : null
        : existing.expiresAt;
    const nextProductIds =
      dto.applicableProductIds !== undefined
        ? [...new Set(dto.applicableProductIds)]
        : existing.applicableProductIds;
    const nextCategoryIds =
      dto.applicableCategoryIds !== undefined
        ? [...new Set(dto.applicableCategoryIds)]
        : existing.applicableCategoryIds;

    this.validateUsageLimits(nextUsageLimit, nextPerUserUsageLimit);
    this.validateDiscountValue(nextType, nextValue);

    if (nextMin.lessThan(0)) {
      throw new BadRequestException('Minimum order amount cannot be negative.');
    }
    if (nextMax !== null && nextMax.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'Maximum discount amount must be greater than zero.',
      );
    }

    // Only reject a past expiry when the caller is changing it; an existing,
    // already-expired code must remain editable (e.g. to deactivate it).
    this.assertValidWindow(nextStartsAt, nextExpiresAt, {
      allowPastExpiry: dto.expiresAt === undefined,
    });

    /**
     * Never allow the global usage limit to drop below redemptions that
     * already happened.
     */
    if (
      nextUsageLimit !== null &&
      nextUsageLimit !== undefined &&
      nextUsageLimit < existing.usageCount
    ) {
      throw new BadRequestException(
        `usageLimit cannot be lower than the current usageCount of ${existing.usageCount}.`,
      );
    }

    const ownerVendorId = vendorId ?? existing.vendorId ?? undefined;
    if (ownerVendorId !== undefined && existing.scope === 'VENDOR') {
      await this.assertVendorRules(ownerVendorId, {
        type: nextType,
        value: nextValue,
        applicableProductIds: nextProductIds,
        applicableCategoryIds: nextCategoryIds,
      });
    }

    let normalizedCode: string | undefined;

    if (dto.code !== undefined) {
      normalizedCode = this.normalizeCode(dto.code);
      this.assertValidCodeFormat(normalizedCode);

      const duplicate = await this.prisma.discountCode.findFirst({
        where: {
          code: normalizedCode,
          NOT: {
            id: discountCodeId,
          },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException(
          'A discount code with this code already exists.',
        );
      }
    }

    // platform-wide semantics: vendors can never set it explicitly.
    const nextPlatformwide =
      existing.scope === 'VENDOR'
        ? nextProductIds.length === 0 && nextCategoryIds.length === 0
        : (dto.platformwide ?? existing.platformwide);

    let updated: DiscountCode;
    try {
      updated = await this.prisma.discountCode.update({
        where: {
          id: discountCodeId,
        },

        data: {
          ...(normalizedCode !== undefined && { code: normalizedCode }),
          ...(dto.description !== undefined && {
            description: dto.description?.trim() || null,
          }),
          type: nextType,
          value: nextValue,
          maxDiscountAmount: nextMax,
          minOrderAmount: nextMin,
          usageLimit: nextUsageLimit ?? null,
          perUserUsageLimit: nextPerUserUsageLimit ?? null,
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          startsAt: nextStartsAt,
          expiresAt: nextExpiresAt,
          applicableProductIds: nextProductIds,
          applicableCategoryIds: nextCategoryIds,
          platformwide: nextPlatformwide,
          ...(dto.firstOrderOnly !== undefined && {
            firstOrderOnly: dto.firstOrderOnly,
          }),
          ...(dto.stackable !== undefined && { stackable: dto.stackable }),
          ...(dto.autoApply !== undefined && { autoApply: dto.autoApply }),
          ...(dto.minQuantity !== undefined && {
            minQuantity: dto.minQuantity,
          }),
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'A discount code with this code already exists.',
        );
      }
      throw error;
    }

    await this.purgeDiscountCache();
    return updated;
  }

  // ============================================================
  // VALIDATE DISCOUNT CODE
  // ============================================================

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
      ...new Set(rawCodes.map((c) => this.normalizeCode(c)).filter(Boolean)),
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
    const code = this.normalizeCode(rawCode);

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
    if (this.isFirstOrderOnlyDiscount(discount)) {
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

  /** Call after an order is created so first-order promos disappear at once. */
  async invalidateFirstOrderCache(userId: string): Promise<void> {
    await this.cacheService?.del(`user:has-prior-orders:${userId}`);
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

  async deactivate(
    id: string,
    vendorId?: string,
    isAdmin = false,
  ): Promise<null> {
    // Prisma treats `vendorId: undefined` as "no filter"; never let a
    // non-admin call without a vendor id fall through to an unscoped query.
    if (!isAdmin && !vendorId) {
      throw new NotFoundException('Discount code not found.');
    }
    const discount = await this.prisma.discountCode.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(isAdmin ? {} : { vendorId }),
      },
      select: { id: true },
    });

    if (!discount) {
      throw new NotFoundException('Discount code not found.');
    }

    await this.prisma.discountCode.update({
      where: { id },
      data: { isActive: false },
    });
    await this.auditLog?.log({
      action: 'DISCOUNT_CODE_DEACTIVATED',
      entity: 'DISCOUNT_CODE',
      entityId: id,
      payload: { vendorId, isAdmin },
    });

    await this.purgeDiscountCache();
    return null;
  }

  async reactivate(
    id: string,
    vendorId?: string,
    isAdmin = false,
  ): Promise<null> {
    // Prisma treats `vendorId: undefined` as "no filter"; never let a
    // non-admin call without a vendor id fall through to an unscoped query.
    if (!isAdmin && !vendorId) {
      throw new NotFoundException('Discount code not found.');
    }
    const discount = await this.prisma.discountCode.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(isAdmin ? {} : { vendorId }),
      },
      select: { id: true },
    });

    if (!discount) {
      throw new NotFoundException('Discount code not found.');
    }

    await this.prisma.discountCode.update({
      where: { id },
      data: { isActive: true },
    });
    await this.auditLog?.log({
      action: 'DISCOUNT_CODE_REACTIVATED',
      entity: 'DISCOUNT_CODE',
      entityId: id,
      payload: { vendorId, isAdmin },
    });

    await this.purgeDiscountCache();
    return null;
  }

  async remove(
    discountCodeId: string,
    vendorId?: string,
    isAdmin = false,
  ): Promise<null> {
    if (!isAdmin && !vendorId) {
      throw new NotFoundException('Discount code not found.');
    }
    const discount = await this.prisma.discountCode.findFirst({
      where: {
        id: discountCodeId,
        deletedAt: null,
        ...(isAdmin ? {} : { vendorId }),
      },
      select: {
        id: true,
        usageCount: true,
      },
    });

    if (!discount) {
      throw new NotFoundException('Discount code not found.');
    }

    if (discount.usageCount > 0) {
      throw new BadRequestException(
        'Cannot delete a discount code that has already been used. Please deactivate it instead.',
      );
    }

    await this.prisma.discountCode.update({
      where: {
        id: discountCodeId,
      },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
    await this.auditLog?.log({
      action: 'DISCOUNT_CODE_DELETED',
      entity: 'DISCOUNT_CODE',
      entityId: discountCodeId,
      payload: { vendorId, isAdmin },
    });

    await this.purgeDiscountCache();
    return null;
  }

  // ============================================================
  // FIND ONE / ALL
  // ============================================================

  async findOne(discountCodeId: string): Promise<DiscountCode> {
    const discount = await this.prisma.discountCode.findFirst({
      where: {
        id: discountCodeId,
        deletedAt: null,
      },
    });

    if (!discount) {
      throw new NotFoundException('Discount code not found.');
    }

    return discount;
  }

  async findAll(limit = 100, offset = 0): Promise<DiscountCode[]> {
    return this.prisma.discountCode.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 200),
      skip: Math.max(offset, 0),
    });
  }

  // ============================================================
  // ADMIN & VENDOR COMPATIBILITY METHODS
  // ============================================================

  async createForAdmin(
    dto: CreateAdminDiscountCodeDto,
  ): Promise<DiscountCodeResponseDto> {
    const created = await this.create(dto);
    await this.auditLog?.log({
      action: 'DISCOUNT_CODE_CREATED',
      entity: 'DISCOUNT_CODE',
      entityId: created.id,
      payload: { vendorId: null, code: created.code },
    });
    return this.toResponseDto(created);
  }

  async findAllForAdmin(
    limit = 100,
    offset = 0,
  ): Promise<DiscountCodeResponseDto[]> {
    const all = await this.findAll(limit, offset);
    return all.map((code) => this.toResponseDto(code));
  }

  async updateForAdmin(
    id: string,
    dto: UpdateAdminDiscountCodeDto,
  ): Promise<DiscountCodeResponseDto> {
    const updated = await this.update(id, dto);
    await this.auditLog?.log({
      action: 'DISCOUNT_CODE_UPDATED',
      entity: 'DISCOUNT_CODE',
      entityId: updated.id,
      payload: { actorType: 'ADMIN', updatedFields: Object.keys(dto) },
    });
    return this.toResponseDto(updated);
  }

  async createForVendor(
    vendorId: string,
    dto: CreateVendorDiscountCodeDto,
  ): Promise<DiscountCodeResponseDto> {
    const created = await this.create(dto, vendorId);
    await this.auditLog?.log({
      action: 'DISCOUNT_CODE_CREATED',
      entity: 'DISCOUNT_CODE',
      entityId: created.id,
      payload: { vendorId, code: created.code },
    });
    return this.toResponseDto(created);
  }

  async findAllForVendor(
    vendorId: string,
    limit = 100,
    offset = 0,
  ): Promise<DiscountCodeResponseDto[]> {
    const codes = await this.prisma.discountCode.findMany({
      where: {
        vendorId,
        deletedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 200),
      skip: Math.max(offset, 0),
    });
    return codes.map((code) => this.toResponseDto(code));
  }

  async updateForVendor(
    id: string,
    vendorId: string,
    dto: UpdateVendorDiscountCodeDto,
  ): Promise<DiscountCodeResponseDto> {
    const existing = await this.prisma.discountCode.findFirst({
      where: {
        id,
        vendorId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException(
        'Discount code not found or you do not have access.',
      );
    }

    const updated = await this.update(id, dto, vendorId);
    await this.auditLog?.log({
      action: 'DISCOUNT_CODE_UPDATED',
      entity: 'DISCOUNT_CODE',
      entityId: updated.id,
      payload: { vendorId, updatedFields: Object.keys(dto) },
    });
    return this.toResponseDto(updated);
  }

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

  toResponseDto(code: DiscountCode): DiscountCodeResponseDto {
    return {
      id: code.id,
      code: code.code,
      description: code.description,
      type: code.type,
      value: Number(code.value),
      maxDiscountAmount:
        code.maxDiscountAmount !== null ? Number(code.maxDiscountAmount) : null,
      minOrderAmount: Number(code.minOrderAmount),
      usageLimit: code.usageLimit,
      perUserUsageLimit: code.perUserUsageLimit,
      usageCount: code.usageCount,
      isActive: code.isActive,
      platformwide: code.platformwide,
      firstOrderOnly: code.firstOrderOnly,
      stackable: code.stackable,
      autoApply: code.autoApply,
      minQuantity: code.minQuantity,
      startsAt: code.startsAt,
      expiresAt: code.expiresAt,
      scope: code.scope,
      applicableProductIds: code.applicableProductIds,
      applicableCategoryIds: code.applicableCategoryIds,
      vendorId: code.vendorId,
      createdAt: code.createdAt,
      updatedAt: code.updatedAt,
    };
  }

  // ============================================================
  // PUBLIC STOREFRONT PROMOTIONS & DEALS
  // ============================================================

  /**
   * Discounts this customer has already used the maximum number of times
   * (`perUserUsageLimit`). Storefront surfaces hide them for that customer: a
   * "10% OFF" chip or a "with CODE" hint for an offer they can no longer use is noise,
   * and the claim/checkout rules would refuse it anyway.
   */
  async findExhaustedCodeIds(
    userId: string | undefined,
    codeIds: string[],
  ): Promise<Set<string>> {
    if (!userId || codeIds.length === 0) return new Set();
    const [codes, usages] = await Promise.all([
      this.prisma.discountCode.findMany({
        where: { id: { in: codeIds }, perUserUsageLimit: { not: null } },
        select: { id: true, perUserUsageLimit: true },
      }),
      this.prisma.discountCodeUserUsage.findMany({
        where: { userId, discountCodeId: { in: codeIds } },
        select: { discountCodeId: true, usageCount: true },
      }),
    ]);
    const used = new Map(usages.map((u) => [u.discountCodeId, u.usageCount]));
    return new Set(
      codes
        .filter((c) => (used.get(c.id) ?? 0) >= (c.perUserUsageLimit ?? 0))
        .map((c) => c.id),
    );
  }

  async getPublicPlatformPromos(
    userId?: string,
  ): Promise<PublicPlatformPromoDto[]> {
    const fetcher = async () => {
      const now = new Date();
      const upcomingThreshold = new Date(
        now.getTime() + 7 * 24 * 60 * 60 * 1000,
      );
      const codes = await this.prisma.discountCode.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          scope: DiscountCodeScope.PLATFORM,
          AND: [
            {
              OR: [
                { startsAt: null },
                { startsAt: { lte: upcomingThreshold } },
              ],
            },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
      });

      // Exhausted codes are removed BEFORE the display limit so they can never
      // crowd valid codes out of the banner. Percent offers rank above fixed
      // ones (their raw numbers are not comparable), then by size.
      const rankValue = (c: (typeof codes)[number]) =>
        (c.type === DiscountCodeType.PERCENTAGE ? 1_000_000 : 0) +
        Number(c.value);
      const started = (c: (typeof codes)[number]) =>
        c.startsAt === null || c.startsAt <= now ? 0 : 1;

      return codes
        .filter((c) => c.usageLimit === null || c.usageCount < c.usageLimit)
        .sort(
          (a, b) =>
            started(a) - started(b) ||
            // A welcome offer for first-time shoppers never outranks the
            // campaigns everyone can use.
            Number(this.isFirstOrderOnlyDiscount(a)) -
              Number(this.isFirstOrderOnlyDiscount(b)) ||
            rankValue(b) - rankValue(a) ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        )
        .slice(0, 10)
        .map((c) => ({
          id: c.id,
          code: c.code,
          description: c.description,
          type: c.type,
          value: Number(c.value),
          maxDiscountAmount: c.maxDiscountAmount
            ? Number(c.maxDiscountAmount)
            : null,
          minOrderAmount: Number(c.minOrderAmount),
          startsAt: c.startsAt,
          expiresAt: c.expiresAt,
          isFirstOrderOnly: this.isFirstOrderOnlyDiscount(c),
          autoApply: c.autoApply,
        }));
    };

    const promos = this.cacheService
      ? await this.cacheService.wrap(
          'discounts:platform-promos:v3',
          120,
          fetcher,
        )
      : await fetcher();
    const visible = (await this.hasPriorNonCancelledOrders(userId))
      ? promos.filter((promo) => !promo.isFirstOrderOnly)
      : promos;
    const exhausted = await this.findExhaustedCodeIds(
      userId,
      visible.map((promo) => promo.id),
    );
    if (exhausted.size === 0) return visible;
    // Keep them (a vanishing banner looks like a bug) but flag them so the storefront can
    // tag the offer as used instead of offering it; used offers go last.
    return visible
      .map((promo) => ({ ...promo, usedByYou: exhausted.has(promo.id) }))
      .sort((a, b) => Number(a.usedByYou) - Number(b.usedByYou));
  }

  async getPublicProductDeals(
    productId: string,
    userId?: string,
  ): Promise<PublicProductDealDto> {
    type CachedPublicProductDeal = PublicProductDealDto & {
      productPrice: number;
    };
    const fetcher = async (): Promise<CachedPublicProductDeal> => {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          vendorId: true,
          categoryId: true,
          category: { select: { parentId: true } },
          price: true,
          isActive: true,
          isDeleted: true,
        },
      });

      if (!product || !product.isActive || product.isDeleted) {
        return {
          productId,
          bestDiscount: null,
          unlockableDiscount: null,
          allVouchers: [],
          productPrice: 0,
        };
      }

      const now = new Date();
      const productPrice = Number(product.price);
      const productCategoryIds = [
        product.categoryId,
        ...(product.category?.parentId ? [product.category.parentId] : []),
      ];

      const codes = await this.prisma.discountCode.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          ],
          OR: [
            { platformwide: true },
            { vendorId: product.vendorId },
            { applicableProductIds: { has: productId } },
            { applicableCategoryIds: { hasSome: productCategoryIds } },
          ],
        },
        orderBy: [{ value: 'desc' }],
      });

      // DB filter above is only a coarse pre-filter; the shared eligibility
      // rules decide what is actually shown, exactly as checkout will.
      const validCodes = codes.filter(
        (c) =>
          (c.usageLimit === null || c.usageCount < c.usageLimit) &&
          isProductEligible(c, {
            id: productId,
            vendorId: product.vendorId,
            categoryIds: productCategoryIds,
          }),
      );

      const allVouchers: ProductVoucherSummaryDto[] = validCodes.map((c) => {
        const val = Number(c.value);
        const minOrder = Number(c.minOrderAmount);
        const spendMet = productPrice >= minOrder || minOrder <= 0;
        // "Buy 3+" offers cannot apply to one item, so they are shown as conditional.
        const meetsMinSpend = spendMet && (c.minQuantity ?? 1) <= 1;
        const shortfall = spendMet ? 0 : Math.max(0, minOrder - productPrice);

        let estimatedSavings = 0;
        if (c.type === DiscountCodeType.PERCENTAGE) {
          estimatedSavings = (productPrice * val) / 100;
          if (c.maxDiscountAmount) {
            estimatedSavings = Math.min(
              estimatedSavings,
              Number(c.maxDiscountAmount),
            );
          }
        } else {
          estimatedSavings = Math.min(productPrice, val);
        }

        const dealPrice = Math.max(
          0,
          Math.round((productPrice - estimatedSavings) * 100) / 100,
        );

        return {
          id: c.id,
          code: c.code,
          description: c.description,
          type: c.type,
          value: val,
          scope: c.scope,
          minOrderAmount: minOrder,
          maxDiscountAmount: c.maxDiscountAmount
            ? Number(c.maxDiscountAmount)
            : null,
          estimatedSavings: Math.round(estimatedSavings * 100) / 100,
          dealPrice: meetsMinSpend ? dealPrice : undefined,
          isApplicable: meetsMinSpend,
          minOrderShortfall: Math.round(shortfall * 100) / 100,
          expiresAt: c.expiresAt,
          isFirstOrderOnly: this.isFirstOrderOnlyDiscount(c),
          autoApply: c.autoApply,
          minQuantity: c.minQuantity,
        };
      });

      // Prioritize immediately applicable deals first (highest savings),
      // then conditional/unlockable order vouchers (lowest spend deficit first)
      allVouchers.sort((a, b) => {
        if (a.isApplicable && !b.isApplicable) return -1;
        if (!a.isApplicable && b.isApplicable) return 1;
        if (a.isApplicable && b.isApplicable) {
          return b.estimatedSavings - a.estimatedSavings;
        }
        const diff = (a.minOrderShortfall ?? 0) - (b.minOrderShortfall ?? 0);
        if (diff !== 0) return diff;
        return b.estimatedSavings - a.estimatedSavings;
      });

      const topApplicable = allVouchers.find(
        (v) => v.isApplicable && v.estimatedSavings > 0,
      );
      const bestDiscount = topApplicable
        ? {
            ...topApplicable,
            dealPrice:
              topApplicable.dealPrice ??
              Math.max(
                0,
                Math.round(
                  (productPrice - topApplicable.estimatedSavings) * 100,
                ) / 100,
              ),
          }
        : null;

      const topConditional = allVouchers.find(
        (v) => !v.isApplicable && v.estimatedSavings > 0,
      );
      const unlockableDiscount = topConditional
        ? {
            ...topConditional,
            minOrderAmount: topConditional.minOrderAmount,
            minOrderShortfall: topConditional.minOrderShortfall ?? 0,
          }
        : null;

      return {
        productId,
        bestDiscount,
        unlockableDiscount,
        allVouchers,
        productPrice,
      };
    };

    const cachedDeal = this.cacheService
      ? await this.cacheService.wrap(
          `discounts:product:v4:${productId}`,
          180,
          fetcher,
        )
      : await fetcher();

    const hasPriorOrders = await this.hasPriorNonCancelledOrders(userId);
    const exhausted = await this.findExhaustedCodeIds(
      userId,
      cachedDeal.allVouchers.map((voucher) => voucher.id),
    );
    if (hasPriorOrders || exhausted.size > 0) {
      // Used-up vouchers stay in the list (flagged) so the product page can say "Used",
      // but never count towards the best or unlockable deal.
      const allVouchers = cachedDeal.allVouchers
        .filter((voucher) => !hasPriorOrders || !voucher.isFirstOrderOnly)
        .map((voucher) =>
          exhausted.has(voucher.id) ? { ...voucher, usedByYou: true } : voucher,
        )
        .sort((a, b) => Number(!!a.usedByYou) - Number(!!b.usedByYou));
      const topApplicable = allVouchers.find(
        (v) => !v.usedByYou && v.isApplicable && v.estimatedSavings > 0,
      );
      const topConditional = allVouchers.find(
        (v) => !v.usedByYou && !v.isApplicable && v.estimatedSavings > 0,
      );
      return {
        productId,
        allVouchers,
        bestDiscount: topApplicable
          ? {
              ...topApplicable,
              dealPrice:
                topApplicable.dealPrice ??
                Math.max(
                  0,
                  Math.round(
                    (cachedDeal.productPrice - topApplicable.estimatedSavings) *
                      100,
                  ) / 100,
                ),
            }
          : null,
        unlockableDiscount: topConditional
          ? {
              ...topConditional,
              minOrderAmount: topConditional.minOrderAmount,
              minOrderShortfall: topConditional.minOrderShortfall ?? 0,
            }
          : null,
      };
    }

    return {
      productId,
      bestDiscount: cachedDeal.bestDiscount,
      unlockableDiscount: cachedDeal.unlockableDiscount,
      allVouchers: cachedDeal.allVouchers,
    };
  }

  /** Card deals for a batch of products, minus offers this customer has used up. */
  async getBatchProductDeals(
    dto: BatchProductDiscountsDto,
    userId?: string,
  ): ReturnType<DiscountCodeService['computeBatchProductDeals']> {
    const result = await this.computeBatchProductDeals(dto, userId);
    if (!userId) return result;

    const ids = new Set<string>();
    for (const entry of Object.values(result)) {
      if (entry.bestDiscount) ids.add(entry.bestDiscount.id);
      if (entry.unlockableDiscount) ids.add(entry.unlockableDiscount.id);
    }
    const exhausted = await this.findExhaustedCodeIds(userId, [...ids]);
    if (exhausted.size === 0) return result;

    for (const entry of Object.values(result)) {
      if (entry.bestDiscount && exhausted.has(entry.bestDiscount.id)) {
        entry.bestDiscount = null;
      }
      if (
        entry.unlockableDiscount &&
        exhausted.has(entry.unlockableDiscount.id)
      ) {
        entry.unlockableDiscount = null;
      }
    }
    return result;
  }

  private async computeBatchProductDeals(
    dto: BatchProductDiscountsDto,
    userId?: string,
  ): Promise<
    Record<
      string,
      {
        bestDiscount: (ProductVoucherSummaryDto & { dealPrice: number }) | null;
        unlockableDiscount?:
          | (ProductVoucherSummaryDto & {
              minOrderAmount: number;
              minOrderShortfall: number;
            })
          | null;
      }
    >
  > {
    const productIds = [...new Set(dto.productIds)];
    if (productIds.length === 0) return {};

    const hasPriorOrders = await this.hasPriorNonCancelledOrders(userId);
    const audienceKey = hasPriorOrders ? 'repeat' : 'first';

    const result: Record<
      string,
      {
        bestDiscount: (ProductVoucherSummaryDto & { dealPrice: number }) | null;
        unlockableDiscount?:
          | (ProductVoucherSummaryDto & {
              minOrderAmount: number;
              minOrderShortfall: number;
            })
          | null;
      }
    > = {};

    const uncachedIds: string[] = [];

    if (this.cacheService) {
      await Promise.all(
        productIds.map(async (id) => {
          const cached = await this.cacheService?.get<{
            bestDiscount:
              | (ProductVoucherSummaryDto & {
                  dealPrice: number;
                })
              | null;
            unlockableDiscount?:
              | (ProductVoucherSummaryDto & {
                  minOrderAmount: number;
                  minOrderShortfall: number;
                })
              | null;
          }>(`discounts:deal:v4:${id}:${audienceKey}`);
          if (cached !== undefined) {
            result[id] = cached;
          } else {
            uncachedIds.push(id);
          }
        }),
      );
    } else {
      uncachedIds.push(...productIds);
    }

    if (uncachedIds.length === 0) {
      return result;
    }

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: uncachedIds },
        isActive: true,
        isDeleted: false,
      },
      select: {
        id: true,
        vendorId: true,
        categoryId: true,
        category: { select: { parentId: true } },
        price: true,
      },
    });

    const categoryIdsOf = (p: (typeof products)[number]) => [
      p.categoryId,
      ...(p.category?.parentId ? [p.category.parentId] : []),
    ];
    const vendorIds = [...new Set(products.map((p) => p.vendorId))];
    const now = new Date();

    const codes = await this.prisma.discountCode.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
        OR: [
          { platformwide: true },
          { vendorId: { in: vendorIds } },
          { applicableProductIds: { hasSome: uncachedIds } },
          {
            applicableCategoryIds: {
              hasSome: [...new Set(products.flatMap(categoryIdsOf))],
            },
          },
        ],
      },
    });

    const validCodes = codes.filter(
      (c) =>
        (c.usageLimit === null || c.usageCount < c.usageLimit) &&
        (!hasPriorOrders || !this.isFirstOrderOnlyDiscount(c)),
    );

    for (const prod of products) {
      const prodPrice = Number(prod.price);
      const prodCategoryIds = categoryIdsOf(prod);
      const matchingCodes = validCodes.filter((c) =>
        isProductEligible(c, {
          id: prod.id,
          vendorId: prod.vendorId,
          categoryIds: prodCategoryIds,
        }),
      );

      let best: (ProductVoucherSummaryDto & { dealPrice: number }) | null =
        null;
      let maxApplicableSavings = 0;

      let unlockable:
        | (ProductVoucherSummaryDto & {
            minOrderAmount: number;
            minOrderShortfall: number;
          })
        | null = null;
      let maxConditionalSavings = 0;

      for (const c of matchingCodes) {
        const val = Number(c.value);
        const minOrder = Number(c.minOrderAmount);
        const spendMet = prodPrice >= minOrder || minOrder <= 0;
        const meetsMinSpend = spendMet && (c.minQuantity ?? 1) <= 1;
        const shortfall = spendMet ? 0 : Math.max(0, minOrder - prodPrice);

        let savings = 0;
        if (c.type === DiscountCodeType.PERCENTAGE) {
          savings = (prodPrice * val) / 100;
          if (c.maxDiscountAmount) {
            savings = Math.min(savings, Number(c.maxDiscountAmount));
          }
        } else {
          savings = Math.min(prodPrice, val);
        }

        const voucherSummary: ProductVoucherSummaryDto = {
          id: c.id,
          code: c.code,
          description: c.description,
          type: c.type,
          value: val,
          scope: c.scope,
          minOrderAmount: minOrder,
          maxDiscountAmount: c.maxDiscountAmount
            ? Number(c.maxDiscountAmount)
            : null,
          estimatedSavings: Math.round(savings * 100) / 100,
          dealPrice: meetsMinSpend
            ? Math.max(0, Math.round((prodPrice - savings) * 100) / 100)
            : undefined,
          isApplicable: meetsMinSpend,
          minOrderShortfall: Math.round(shortfall * 100) / 100,
          expiresAt: c.expiresAt,
          isFirstOrderOnly: this.isFirstOrderOnlyDiscount(c),
          autoApply: c.autoApply,
          minQuantity: c.minQuantity,
        };

        if (meetsMinSpend) {
          if (savings > maxApplicableSavings) {
            maxApplicableSavings = savings;
            best = {
              ...voucherSummary,
              dealPrice: Math.max(
                0,
                Math.round((prodPrice - savings) * 100) / 100,
              ),
            };
          }
        } else {
          if (savings > maxConditionalSavings) {
            maxConditionalSavings = savings;
            unlockable = {
              ...voucherSummary,
              minOrderAmount: minOrder,
              minOrderShortfall: Math.round(shortfall * 100) / 100,
            };
          }
        }
      }

      const dealEntry = { bestDiscount: best, unlockableDiscount: unlockable };
      result[prod.id] = dealEntry;
      if (this.cacheService) {
        void this.cacheService.set(
          `discounts:deal:v4:${prod.id}:${audienceKey}`,
          dealEntry,
          180,
        );
      }
    }

    return result;
  }
}

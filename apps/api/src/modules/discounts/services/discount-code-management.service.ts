import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import {
  DiscountCode,
  DiscountCodeScope,
  DiscountCodeType,
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
  CreateAdminDiscountCodeDto,
  CreateDiscountCodeDto,
  CreateVendorDiscountCodeDto,
  DiscountCodeResponseDto,
  UpdateAdminDiscountCodeDto,
  UpdateDiscountCodeDto,
  UpdateVendorDiscountCodeDto,
} from '../dto';

import {
  normalizeDiscountCode,
  toDiscountResponseDto,
} from '../utils/discount-code.util';

/**
 * Creating and maintaining discount codes: the rules a code must satisfy (format, window, value,
 * limits, vendor ownership), generating automatic codes, and activating, deactivating or removing
 * them, for administrators and for vendors. Redeeming a code is `DiscountCodeService`.
 */
@Injectable()
export class DiscountCodeManagementService {
  private readonly logger = new Logger(DiscountCodeManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

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

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

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
      ? normalizeDiscountCode(dto.code)
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
      normalizedCode = normalizeDiscountCode(dto.code);
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
    return toDiscountResponseDto(created);
  }

  async findAllForAdmin(
    limit = 100,
    offset = 0,
  ): Promise<DiscountCodeResponseDto[]> {
    const all = await this.findAll(limit, offset);
    return all.map((code) => toDiscountResponseDto(code));
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
    return toDiscountResponseDto(updated);
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
    return toDiscountResponseDto(created);
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
    return codes.map((code) => toDiscountResponseDto(code));
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
    return toDiscountResponseDto(updated);
  }
}

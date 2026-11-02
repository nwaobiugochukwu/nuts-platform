import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import {
  DiscountCode,
  DiscountCodeScope,
  DiscountCodeType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import { AuditLogService } from '@api/modules/shared/audit-log/audit-log.service';

import {
  CreateAdminDiscountCodeDto,
  CreateDiscountCodeDto,
  CreateVendorDiscountCodeDto,
  DiscountCodeResponseDto,
  UpdateAdminDiscountCodeDto,
  UpdateDiscountCodeDto,
  UpdateVendorDiscountCodeDto,
} from './dto';

@Injectable()
export class DiscountCodeService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly auditLog?: AuditLogService,
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

  // ============================================================
  // CREATE
  // ============================================================

  async create(
    dto: CreateDiscountCodeDto,
    vendorId?: string,
  ): Promise<DiscountCode> {
    const code = this.normalizeCode(dto.code);

    this.validateUsageLimits(dto.usageLimit, dto.perUserUsageLimit);

    this.validateDiscountValue(dto.type, dto.value);

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

    const applicableProductIds = dto.applicableProductIds ?? [];

    return this.prisma.discountCode.create({
      data: {
        code,

        description: dto.description?.trim() || null,

        type: dto.type,

        value: new Prisma.Decimal(dto.value),

        maxDiscountAmount:
          dto.maxDiscountAmount !== undefined && dto.maxDiscountAmount !== null
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

        /**
         * Empty product list means the vendor's discount
         * applies to all of their products.
         */
        platformwide: dto.platformwide ?? applicableProductIds.length === 0,

        scope,
      },
    });
  }

  // ============================================================
  // UPDATE
  // ============================================================

  async update(
    discountCodeId: string,
    dto: UpdateDiscountCodeDto,
  ): Promise<DiscountCode> {
    const existing = await this.prisma.discountCode.findUnique({
      where: { id: discountCodeId },
      select: {
        id: true,
        code: true,
        usageCount: true,
        usageLimit: true,
        perUserUsageLimit: true,
        deletedAt: true,
      },
    });

    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Discount code not found.');
    }

    const nextUsageLimit =
      dto.usageLimit !== undefined ? dto.usageLimit : existing.usageLimit;

    const nextPerUserUsageLimit =
      dto.perUserUsageLimit !== undefined
        ? dto.perUserUsageLimit
        : existing.perUserUsageLimit;

    this.validateUsageLimits(nextUsageLimit, nextPerUserUsageLimit);

    /**
     * Never allow an administrator to reduce the global usage
     * limit below the number of redemptions that already happened.
     *
     * Example:
     *
     * usageCount = 50
     * new usageLimit = 20
     *
     * That would make the stored state contradictory.
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

    if (dto.type !== undefined && dto.value !== undefined) {
      this.validateDiscountValue(dto.type, dto.value);
    }

    let normalizedCode: string | undefined;

    if (dto.code !== undefined) {
      normalizedCode = this.normalizeCode(dto.code);

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

    return this.prisma.discountCode.update({
      where: {
        id: discountCodeId,
      },

      data: {
        ...(normalizedCode !== undefined && {
          code: normalizedCode,
        }),

        ...(dto.description !== undefined && {
          description: dto.description?.trim() || null,
        }),

        ...(dto.type !== undefined && {
          type: dto.type,
        }),

        ...(dto.value !== undefined && {
          value: new Prisma.Decimal(dto.value),
        }),

        ...(dto.maxDiscountAmount !== undefined && {
          maxDiscountAmount:
            dto.maxDiscountAmount === null
              ? null
              : new Prisma.Decimal(dto.maxDiscountAmount),
        }),

        ...(dto.minOrderAmount !== undefined && {
          minOrderAmount: new Prisma.Decimal(dto.minOrderAmount),
        }),

        ...(dto.usageLimit !== undefined && {
          usageLimit: dto.usageLimit,
        }),

        ...(dto.perUserUsageLimit !== undefined && {
          perUserUsageLimit: dto.perUserUsageLimit,
        }),

        ...(dto.isActive !== undefined && {
          isActive: dto.isActive,
        }),

        ...(dto.startsAt !== undefined && {
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        }),

        ...(dto.expiresAt !== undefined && {
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        }),

        ...(dto.applicableProductIds !== undefined && {
          applicableProductIds: dto.applicableProductIds,
        }),

        ...(dto.platformwide !== undefined && {
          platformwide: dto.platformwide,
        }),
      },
    });
  }

  // ============================================================
  // VALIDATE DISCOUNT CODE
  // ============================================================

  async validate(
    rawCode: string,
    userId: string,
    orderAmount: Prisma.Decimal,
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
    if (
      discount.usageLimit !== null &&
      discount.usageCount >= discount.usageLimit
    ) {
      throw new ConflictException(
        'This discount code has reached its usage limit.',
      );
    }

    if (orderAmount.lessThan(discount.minOrderAmount)) {
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
          "expiresAt"
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

    // ----------------------------------------------------------
    // 4. Check global usage limit.
    // ----------------------------------------------------------

    if (
      discount.usageLimit !== null &&
      discount.usageCount >= discount.usageLimit
    ) {
      throw new ConflictException(
        'This discount code has reached its usage limit.',
      );
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

    return null;
  }

  async reactivate(
    id: string,
    vendorId?: string,
    isAdmin = false,
  ): Promise<null> {
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

    return null;
  }

  async remove(
    discountCodeId: string,
    vendorId?: string,
    isAdmin = false,
  ): Promise<null> {
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

  async findAll(limit = 100): Promise<DiscountCode[]> {
    return this.prisma.discountCode.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
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

  async findAllForAdmin(limit = 100): Promise<DiscountCodeResponseDto[]> {
    const all = await this.findAll(limit);
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
  ): Promise<DiscountCodeResponseDto[]> {
    const codes = await this.prisma.discountCode.findMany({
      where: {
        vendorId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
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

    const updated = await this.update(id, dto);
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
      startsAt: code.startsAt,
      expiresAt: code.expiresAt,
      scope: code.scope,
      applicableProductIds: code.applicableProductIds,
      vendorId: code.vendorId,
      createdAt: code.createdAt,
      updatedAt: code.updatedAt,
    };
  }
}

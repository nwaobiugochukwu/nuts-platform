import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VendorProfileDto } from '@api/modules/identity/vendors/dto/vendor-response.dto';
import { VendorStatusResponseDto } from '@api/modules/identity/vendors/dto/vendor-status-response.dto';
import { CacheService } from '@api/modules/infrastructure/cache/cache.service';
import { EmailService } from '@api/modules/infrastructure/mail/email.service';
import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import {
  AuditLogService,
  toAuditPayload,
} from '@api/modules/shared/audit-log/audit-log.service';
import {
  VENDOR_STORE,
  VENDOR_STORE_PRODUCTS,
} from '@api/modules/shared/constants/cache.constant';
import { createPaginationMeta } from '@api/modules/shared/utils/pagination-meta.util';
import { getPagination } from '@api/modules/shared/utils/pagination.util';
import { QueryAdminVendorsDto } from './dto/query-admin-vendors.dto';

const vendorSelect = {
  id: true,
  email: true,
  storeName: true,
  storeSlug: true,
  storeDescription: true,
  businessPhone: true,
  businessEmail: true,
  storeLogoUrl: true,
  storeLogoAltText: true,
  isVerified: true,
  isActive: true,
  isApproved: true,
  firstName: true,
  lastName: true,
  phone: true,
  createdAt: true,
  updatedAt: true,
} as const;

type VendorSelectPayload = Prisma.VendorGetPayload<{
  select: typeof vendorSelect;
}>;

/** Columns returned by every status transition — enough for the response, audit and cache keys. */
const statusSelect = {
  id: true,
  isActive: true,
  isApproved: true,
  isVerified: true,
  updatedAt: true,
  email: true,
  storeName: true,
  storeSlug: true,
  firstName: true,
} as const;

type StatusField = 'isActive' | 'isApproved' | 'isVerified';

interface StatusTransition {
  action: string;
  field: StatusField;
  value: boolean;
  /** Extra columns written atomically with the flag (e.g. session revocation). */
  extraData?: Prisma.VendorUpdateInput;
}

/**
 * Public listing caches (`VendorsService.getPublicVendors`) and product listings
 * embed vendor visibility. Any moderation change must evict them, otherwise a
 * deactivated/deleted vendor stays publicly visible until the TTL (1h in prod).
 */
const PUBLIC_VENDOR_LIST_PATTERN = 'vendors:public:*';
const PUBLIC_PRODUCT_LIST_PATTERN = 'products:public:*';

@Injectable()
export class AdminVendorsService {
  private readonly logger = new Logger(AdminVendorsService.name);
  private readonly vendorSelect = vendorSelect;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly cacheService: CacheService,
    private readonly emailService: EmailService,
  ) {}

  async findAll(query: QueryAdminVendorsDto): Promise<{
    data: VendorProfileDto[];
    meta: ReturnType<typeof createPaginationMeta>;
  }> {
    const {
      page = 1,
      limit = 10,
      search,
      isActive,
      isApproved,
      isVerified,
    } = query;

    const where: Prisma.VendorWhereInput = {};

    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      where.OR = [
        { email: { contains: trimmedSearch, mode: 'insensitive' } },
        { storeName: { contains: trimmedSearch, mode: 'insensitive' } },
        { storeSlug: { contains: trimmedSearch, mode: 'insensitive' } },
        { firstName: { contains: trimmedSearch, mode: 'insensitive' } },
        { lastName: { contains: trimmedSearch, mode: 'insensitive' } },
        { businessEmail: { contains: trimmedSearch, mode: 'insensitive' } },
        { businessPhone: { contains: trimmedSearch, mode: 'insensitive' } },
        { phone: { contains: trimmedSearch, mode: 'insensitive' } },
        { storeDescription: { contains: trimmedSearch, mode: 'insensitive' } },
      ];
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (isApproved !== undefined) {
      where.isApproved = isApproved;
    }

    if (isVerified !== undefined) {
      where.isVerified = isVerified;
    }

    const [total, vendors] = await Promise.all([
      this.prisma.vendor.count({ where }),
      this.prisma.vendor.findMany({
        where,
        select: this.vendorSelect,
        // Secondary key keeps pagination stable when createdAt collides.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...getPagination(page, limit),
      }),
    ]);

    return {
      data: vendors.map((vendor) => this.toVendorProfile(vendor)),
      meta: createPaginationMeta(total, page, limit),
    };
  }

  async findOne(id: string): Promise<VendorProfileDto> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      select: this.vendorSelect,
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    return this.toVendorProfile(vendor);
  }

  approve(
    adminId: string,
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorStatusResponseDto> {
    return this.transitionStatus(
      adminId,
      id,
      {
        action: 'APPROVE_VENDOR',
        field: 'isApproved',
        value: true,
        extraData: { tokenVersion: { increment: 1 } },
      },
      ipAddress,
      userAgent,
    );
  }

  verify(
    adminId: string,
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorStatusResponseDto> {
    return this.transitionStatus(
      adminId,
      id,
      { action: 'VERIFY_VENDOR', field: 'isVerified', value: true },
      ipAddress,
      userAgent,
    );
  }

  deactivate(
    adminId: string,
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorStatusResponseDto> {
    return this.transitionStatus(
      adminId,
      id,
      {
        action: 'DEACTIVATE_VENDOR',
        field: 'isActive',
        value: false,
        // Revoke every live session atomically with the flag flip.
        extraData: {
          refreshToken: null,
          refreshTokenId: null,
          tokenVersion: { increment: 1 },
        },
      },
      ipAddress,
      userAgent,
    );
  }

  reactivate(
    adminId: string,
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorStatusResponseDto> {
    return this.transitionStatus(
      adminId,
      id,
      {
        action: 'REACTIVATE_VENDOR',
        field: 'isActive',
        value: true,
        extraData: { tokenVersion: { increment: 1 } },
      },
      ipAddress,
      userAgent,
    );
  }

  async delete(
    adminId: string,
    id: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    let vendor: {
      id: string;
      email: string;
      storeName: string;
      storeSlug: string;
    };
    try {
      vendor = await this.prisma.vendor.delete({
        where: { id },
        select: { id: true, email: true, storeName: true, storeSlug: true },
      });
    } catch (error) {
      this.rethrowNotFound(error);
    }

    await Promise.all([
      this.invalidateVendorCaches(vendor.storeSlug),
      this.auditLog.log({
        action: 'DELETE_VENDOR',
        entity: 'Vendor',
        entityId: id,
        adminId,
        payload: toAuditPayload({
          email: vendor.email,
          storeName: vendor.storeName,
        }),
        ipAddress,
        userAgent,
      }),
    ]);
  }

  /**
   * Single code path for every moderation flag change:
   *   1. read previous value (for the audit diff)
   *   2. atomic update (flag + any session-revocation columns)
   *   3. evict public caches + write audit log in parallel
   *
   * A missing vendor surfaces as 404 rather than an unhandled Prisma P2025 (500).
   */
  private async transitionStatus(
    adminId: string,
    id: string,
    transition: StatusTransition,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorStatusResponseDto> {
    const { action, field, value, extraData } = transition;

    const before = await this.prisma.vendor.findUnique({
      where: { id },
      select: { [field]: true } as Record<StatusField, true>,
    });

    if (!before) {
      throw new NotFoundException('Vendor not found');
    }

    let vendor: Prisma.VendorGetPayload<{ select: typeof statusSelect }>;
    try {
      vendor = await this.prisma.vendor.update({
        where: { id },
        data: { ...extraData, [field]: value },
        select: statusSelect,
      });
    } catch (error) {
      // Vendor deleted between the read and the write.
      this.rethrowNotFound(error);
    }

    await Promise.all([
      this.invalidateVendorCaches(vendor.storeSlug),
      this.auditLog.log({
        action,
        entity: 'Vendor',
        entityId: id,
        adminId,
        payload: toAuditPayload({
          email: vendor.email,
          storeName: vendor.storeName,
          changes: {
            [field]: {
              old: (before as Record<StatusField, boolean>)[field],
              new: value,
            },
          },
        }),
        ipAddress,
        userAgent,
      }),
    ]);

    if (action === 'APPROVE_VENDOR' && value === true) {
      void this.emailService
        .sendVendorApprovedEmail(
          vendor.email,
          vendor.storeName,
          vendor.firstName || undefined,
        )
        .catch((err) => {
          this.logger.error(
            `Failed to send vendor approval email to ${vendor.email}`,
            err,
          );
        });
    }

    return {
      id: vendor.id,
      isActive: vendor.isActive,
      isApproved: vendor.isApproved,
      isVerified: vendor.isVerified,
      updatedAt: vendor.updatedAt,
    };
  }

  /**
   * Cache eviction is best-effort: the DB write has already committed, so a
   * Redis outage must not turn a successful moderation action into a 500.
   * CacheService already logs Redis failures; this guards against anything else.
   */
  private async invalidateVendorCaches(storeSlug: string): Promise<void> {
    const results = await Promise.allSettled([
      this.cacheService.del(VENDOR_STORE(storeSlug)),
      this.cacheService.del(VENDOR_STORE_PRODUCTS(storeSlug)),
      this.cacheService.delByPattern(PUBLIC_VENDOR_LIST_PATTERN),
      this.cacheService.delByPattern(PUBLIC_PRODUCT_LIST_PATTERN),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Vendor cache invalidation failed for "${storeSlug}"`,
          result.reason,
        );
      }
    }
  }

  private rethrowNotFound(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundException('Vendor not found');
    }
    throw error;
  }

  private toVendorProfile(vendor: VendorSelectPayload): VendorProfileDto {
    return {
      id: vendor.id,
      email: vendor.email,
      storeName: vendor.storeName,
      storeSlug: vendor.storeSlug,
      storeDescription: vendor.storeDescription,
      businessPhone: vendor.businessPhone,
      businessEmail: vendor.businessEmail,
      storeLogoUrl: vendor.storeLogoUrl,
      storeLogoAltText: vendor.storeLogoAltText,
      firstName: vendor.firstName,
      lastName: vendor.lastName,
      phone: vendor.phone,
      isVerified: vendor.isVerified,
      isActive: vendor.isActive,
      isApproved: vendor.isApproved,
      createdAt: vendor.createdAt,
      updatedAt: vendor.updatedAt,
    };
  }
}

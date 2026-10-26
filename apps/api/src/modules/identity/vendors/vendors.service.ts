// vendors.service.ts

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, ROLE } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import type { AuthTokens } from '@api/modules/auth/types/auth.types';
import { OtpService } from '@api/modules/auth/otp/otp.service';
import { RefreshSessionService } from '@api/modules/auth/sessions/refresh-session.service';
import { CacheService } from '@api/modules/infrastructure/cache/cache.service';
import { EmailService } from '@api/modules/infrastructure/mail/email.service';
import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import { resolveCategoryHierarchy } from '@api/modules/products/products.service';
import { AccountLockService } from '@api/modules/security/services/account-lock.service';
import {
  AuditLogService,
  toAuditPayload,
  type AuditChanges,
} from '@api/modules/shared/audit-log/audit-log.service';
import {
  BCRYPT_COST_FACTOR,
  UNKNOWN_ACCOUNT_PASSWORD_HASH,
} from '@api/modules/shared/constants/bcrypt.constants';
import {
  VENDOR_STORE,
  VENDOR_STORE_PRODUCTS,
  VENDOR_STORE_TTL,
} from '@api/modules/shared/constants/cache.constant';
import { generateSlug } from '@api/modules/shared/utils/slug.util';

import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto, VendorLoginDto } from './dto/update-vendor.dto';
import { VendorReactivateDto } from './dto/vendor-reactivate.dto';
import { VendorResetPasswordDto } from './dto/vendor-reset-password.dto';
import { VendorProfileDto } from './dto/vendor-response.dto';
import { VendorStatusResponseDto } from './dto/vendor-status-response.dto';

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
  tokenVersion: true,
  createdAt: true,
  updatedAt: true,
} as const;

type VendorSelectPayload = Prisma.VendorGetPayload<{
  select: typeof vendorSelect;
}>;

const storeProductSelect = {
  id: true,
  name: true,
  slug: true,
  price: true,
  stock: true,
  hasVariants: true,
  categoryId: true,
  createdAt: true,
  images: {
    where: {
      isPrimary: true,
    },
    take: 1,
    select: {
      url: true,
    },
  },
  variants: {
    where: {
      isDeleted: false,
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      id: true,
      options: true,
      stock: true,
      isActive: true,
    },
  },
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,
      path: true,
    },
  },
} as const;

export interface VendorSession {
  profile: VendorProfileDto;
  tokens: AuthTokens | null;
}

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
    private readonly auditLog: AuditLogService,
    private readonly cacheService: CacheService,
    private readonly accountLockService: AccountLockService,
    private readonly refreshSessionService: RefreshSessionService,
  ) {}

  async register(
    dto: CreateVendorDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorSession> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const slugSource = dto.storeSlug?.trim() || dto.storeName.trim();
    const storeSlug = generateSlug(slugSource);

    if (!storeSlug) {
      throw new BadRequestException('Invalid store slug or store name');
    }

    /*
     * This is an early friendly validation only.
     *
     * The database unique constraints remain the final protection against
     * concurrent registrations using the same email/store slug.
     */
    const existingVendor = await this.prisma.vendor.findFirst({
      where: {
        OR: [
          {
            email: normalizedEmail,
          },
          {
            storeSlug,
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (existingVendor) {
      throw new ConflictException('Email or store slug already in use');
    }

    await this.otpService.verifyOtp(
      normalizedEmail,
      dto.otpCode,
      'vendor:registration',
    );

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_COST_FACTOR);

    /*
     * The wallet is created as part of the same database operation.
     *
     * This prevents a vendor from being successfully created without the
     * wallet that the rest of the vendor system expects to exist.
     */
    let vendor: VendorSelectPayload;

    try {
      vendor = await this.prisma.vendor.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          storeName: dto.storeName.trim(),
          storeSlug,
          storeDescription: dto.storeDescription?.trim() ?? '',
          businessPhone: dto.businessPhone,
          businessEmail: dto.businessEmail?.trim() ?? '',
          firstName: dto.firstName?.trim() ?? '',
          lastName: dto.lastName?.trim() ?? '',
          phone: dto.phone,
          vendorWallet: {
            create: {},
          },
        },
        select: vendorSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email or store slug already in use');
      }

      throw error;
    }

    void this.auditLog
      .log({
        action: 'VENDOR_REGISTER',
        entity: 'Vendor',
        entityId: vendor.id,
        payload: {
          email: vendor.email,
          storeName: vendor.storeName,
          storeSlug: vendor.storeSlug,
        },
        ipAddress,
        userAgent,
      })
      .catch((error) => {
        this.logger.warn('Failed to log vendor registration audit', error);
      });

    void this.emailService
      .sendVendorApplicationReceivedEmail(
        vendor.email,
        vendor.storeName,
        vendor.firstName || undefined,
      )
      .catch((error) => {
        this.logger.error(
          'Failed to send vendor application received email',
          error,
        );
      });

    /*
     * Vendor registration does NOT auto-login.
     * Unapproved vendors cannot have an active session.
     * The frontend shows a "pending approval" screen instead.
     */
    return {
      profile: this.toVendorProfile(vendor),
      tokens: null,
    };
  }

  async login(
    dto: VendorLoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorSession> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const identifier = `email:${normalizedEmail}`;

    const loginSelect = {
      ...vendorSelect,
      password: true,
    } as const;

    const vendor = await this.prisma.vendor.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: loginSelect,
    });

    const passwordMatches = await bcrypt.compare(
      dto.password,
      vendor?.password ?? UNKNOWN_ACCOUNT_PASSWORD_HASH,
    );

    if (!vendor || !passwordMatches) {
      /*
       * Security-sensitive logging/lock failures should not prevent the
       * authentication response from being returned.
       */
      await Promise.allSettled([
        this.accountLockService.recordFailedAttempt(identifier),
        this.auditLog.log({
          action: 'VENDOR_LOGIN_FAILED',
          entity: 'Vendor',
          entityId: vendor?.id,
          payload: { credentialType: 'email' },
          ipAddress,
          userAgent,
        }),
      ]);

      throw new UnauthorizedException('Invalid credentials');
    }

    if (!vendor.isActive) {
      throw new UnauthorizedException('Vendor account is deactivated');
    }

    if (!vendor.isApproved) {
      throw new UnauthorizedException('Vendor account is not approved yet');
    }

    void this.accountLockService.resetAttempts(identifier).catch((error) => {
      this.logger.warn('Failed to reset vendor login attempts', error);
    });

    /*
     * Password-cost upgrades happen asynchronously so an old hash does not
     * add another expensive bcrypt operation to the login request.
     */
    const hashCost = Number(vendor.password.split('$')[2]);

    if (Number.isFinite(hashCost) && hashCost < BCRYPT_COST_FACTOR) {
      void bcrypt
        .hash(dto.password, BCRYPT_COST_FACTOR)
        .then((upgradedHash) =>
          this.prisma.vendor.update({
            where: {
              id: vendor.id,
            },
            data: {
              password: upgradedHash,
            },
          }),
        )
        .catch((error) => {
          this.logger.warn(
            'Failed to upgrade vendor password hash cost',
            error,
          );
        });
    }

    const session = await this.refreshSessionService.issueVendorSession({
      id: vendor.id,
      email: vendor.email,
      firstName: vendor.firstName,
      lastName: vendor.lastName,
      isActive: vendor.isActive,
      isApproved: vendor.isApproved,
      tokenVersion: vendor.tokenVersion,
    });

    void this.auditLog
      .log({
        action: 'VENDOR_LOGIN',
        entity: 'Vendor',
        entityId: vendor.id,
        payload: { role: 'VENDOR' },
        ipAddress,
        userAgent,
      })
      .catch((error) => {
        this.logger.warn('Failed to write vendor login audit log', error);
      });

    return {
      profile: this.toVendorProfile(vendor),
      tokens: session.tokens,
    };
  }

  async getProfile(vendorId: string): Promise<VendorProfileDto> {
    const vendor = await this.prisma.vendor.findUnique({
      where: {
        id: vendorId,
      },
      select: vendorSelect,
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    return this.toVendorProfile(vendor);
  }

  async updateProfile(
    vendorId: string,
    dto: UpdateVendorDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorProfileDto> {
    const vendor = await this.getVendorOrThrow(vendorId);

    const data: Prisma.VendorUpdateInput = {};

    /*
     * Only send fields that are actually present in the DTO.
     * This prevents undefined values from being unnecessarily included in
     * Prisma update payloads and makes the audit diff accurate.
     */
    if (dto.storeDescription !== undefined) {
      data.storeDescription = dto.storeDescription;
    }

    if (dto.businessPhone !== undefined) {
      data.businessPhone = dto.businessPhone;
    }

    if (dto.businessEmail !== undefined) {
      data.businessEmail = dto.businessEmail;
    }

    if (dto.firstName !== undefined) {
      data.firstName = dto.firstName;
    }

    if (dto.lastName !== undefined) {
      data.lastName = dto.lastName;
    }

    if (dto.phone !== undefined) {
      data.phone = dto.phone;
    }

    if (dto.storeLogoUrl !== undefined) {
      data.storeLogoUrl = dto.storeLogoUrl;
    }

    if (
      dto.storeName !== undefined &&
      dto.storeName.trim() !== vendor.storeName
    ) {
      const storeName = dto.storeName.trim();
      const storeSlug = generateSlug(storeName);

      if (!storeSlug) {
        throw new BadRequestException('Invalid store name');
      }

      /*
       * The uniqueness check is still only a friendly pre-check.
       * The unique DB constraint handles concurrent updates.
       */
      const existingSlug = await this.prisma.vendor.findFirst({
        where: {
          storeSlug,
          id: {
            not: vendorId,
          },
        },
        select: {
          id: true,
        },
      });

      if (existingSlug) {
        throw new ConflictException(
          'Store slug generated from storeName is already in use',
        );
      }

      data.storeName = storeName;
      data.storeSlug = storeSlug;
    }

    if (Object.keys(data).length === 0) {
      return this.toVendorProfile(
        await this.prisma.vendor.findUniqueOrThrow({
          where: {
            id: vendorId,
          },
          select: vendorSelect,
        }),
      );
    }

    let updated: VendorSelectPayload;

    try {
      updated = await this.prisma.vendor.update({
        where: {
          id: vendorId,
        },
        data,
        select: vendorSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Store slug is already in use');
      }

      throw error;
    }

    const changedFields: AuditChanges = {};

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) {
        continue;
      }

      const oldValue = vendor[key as keyof typeof vendor];

      if (oldValue !== value) {
        changedFields[key] = {
          old: oldValue ?? null,
          new: JSON.parse(JSON.stringify(value)) as AuditChanges[string]['new'],
        };
      }
    }

    if (Object.keys(changedFields).length > 0) {
      await this.auditLog.log({
        action: 'VENDOR_UPDATE_PROFILE',
        entity: 'Vendor',
        entityId: vendorId,
        payload: toAuditPayload({
          changes: changedFields,
        }),
        ipAddress,
        userAgent,
      });
    }

    /*
     * Store slug can change during the update.
     * Invalidate both the old and new store cache keys so neither version
     * remains stale.
     */
    const cacheSlugs = new Set([vendor.storeSlug, updated.storeSlug]);

    await Promise.all([
      ...[...cacheSlugs].map((slug) =>
        this.cacheService.del(VENDOR_STORE(slug)),
      ),
      ...[...cacheSlugs].map((slug) =>
        this.cacheService.del(VENDOR_STORE_PRODUCTS(slug)),
      ),
    ]);

    return this.toVendorProfile(updated);
  }

  async deactivateProfile(
    vendorId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorStatusResponseDto> {
    await this.getVendorOrThrow(vendorId);

    const updated = await this.prisma.vendor.update({
      where: {
        id: vendorId,
      },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
        refreshToken: null,
        refreshTokenId: null,
        tokenVersion: { increment: 1 },
      },
      select: {
        id: true,
        isActive: true,
        isApproved: true,
        isVerified: true,
        updatedAt: true,
        email: true,
        storeName: true,
        storeSlug: true,
      },
    });

    await Promise.all([
      this.auditLog.log({
        action: 'VENDOR_SELF_DEACTIVATE',
        entity: 'Vendor',
        entityId: vendorId,
        payload: {
          email: updated.email,
          storeName: updated.storeName,
        },
        ipAddress,
        userAgent,
      }),
      this.cacheService.del(VENDOR_STORE(updated.storeSlug)),
      this.cacheService.del(VENDOR_STORE_PRODUCTS(updated.storeSlug)),
    ]);

    return {
      id: updated.id,
      isActive: updated.isActive,
      isApproved: updated.isApproved,
      isVerified: updated.isVerified,
      updatedAt: updated.updatedAt,
    };
  }

  async reactivate(
    dto: VendorReactivateDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<VendorStatusResponseDto> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const vendor = await this.prisma.vendor.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        password: true,
        isActive: true,
        storeName: true,
        storeSlug: true,
        isApproved: true,
      },
    });

    if (!vendor) {
      // Timing-safe: always compare against dummy hash even if vendor not found
      await bcrypt.compare(dto.password, UNKNOWN_ACCOUNT_PASSWORD_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, vendor.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check active status AFTER password verification to prevent enumeration
    if (vendor.isActive) {
      throw new BadRequestException('Account is already active');
    }

    const updated = await this.prisma.vendor.update({
      where: {
        id: vendor.id,
      },
      data: {
        isActive: true,
        deactivatedAt: null,
        deactivatedReason: null,
        tokenVersion: { increment: 1 },
      },
      select: {
        id: true,
        isActive: true,
        isApproved: true,
        isVerified: true,
        updatedAt: true,
        email: true,
        storeName: true,
        storeSlug: true,
      },
    });

    await Promise.all([
      this.auditLog.log({
        action: 'VENDOR_SELF_REACTIVATE',
        entity: 'Vendor',
        entityId: vendor.id,
        payload: {
          email: updated.email,
          storeName: updated.storeName,
        },
        ipAddress,
        userAgent,
      }),
      this.cacheService.del(VENDOR_STORE(updated.storeSlug)),
      this.cacheService.del(VENDOR_STORE_PRODUCTS(updated.storeSlug)),
    ]);

    return {
      id: updated.id,
      isActive: updated.isActive,
      isApproved: updated.isApproved,
      isVerified: updated.isVerified,
      updatedAt: updated.updatedAt,
    };
  }

  async deleteProfile(
    vendorId: string,
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
        where: {
          id: vendorId,
        },
        select: {
          id: true,
          email: true,
          storeName: true,
          storeSlug: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Vendor not found');
      }

      throw error;
    }

    await Promise.all([
      this.auditLog.log({
        action: 'VENDOR_SELF_DELETE',
        entity: 'Vendor',
        entityId: vendorId,
        payload: {
          email: vendor.email,
          storeName: vendor.storeName,
        },
        ipAddress,
        userAgent,
      }),
      this.cacheService.del(VENDOR_STORE(vendor.storeSlug)),
      this.cacheService.del(VENDOR_STORE_PRODUCTS(vendor.storeSlug)),
    ]);
  }

  async findAllPublicVendors(
    categoryId?: string,
    search?: string,
    requestedLimit?: number,
  ): Promise<VendorProfileDto[]> {
    const trimmedSearch = search?.trim();
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit! > 0
        ? Math.min(50, Math.floor(requestedLimit!))
        : undefined;

    const cacheKey = `vendors:public:${trimmedSearch ? encodeURIComponent(trimmedSearch.toLowerCase()) : 'all'}:${categoryId ?? 'all'}:${limit ?? 'all'}`;

    return this.cacheService.wrapStale(cacheKey, VENDOR_STORE_TTL, async () => {
      let targetCategoryIds: string[] | undefined;
      if (categoryId) {
        const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
            WITH RECURSIVE category_descendants AS (
              SELECT id FROM "categories" WHERE id = ${categoryId}
              UNION ALL
              SELECT c.id FROM "categories" c
              INNER JOIN category_descendants cd ON c."parentId" = cd.id
            )
            SELECT id FROM category_descendants;
          `;
        targetCategoryIds = rows.map((r) => r.id);
        // An unknown category must produce no matches instead of silently
        // dropping the category predicate and returning every vendor.
        if (targetCategoryIds.length === 0) return [];
      }

      const where: Prisma.VendorWhereInput = {
        isActive: true,
        isApproved: true,
        ...(targetCategoryIds && targetCategoryIds.length > 0
          ? {
              products: {
                some: {
                  categoryId: { in: targetCategoryIds },
                  isDeleted: false,
                  isActive: true,
                },
              },
            }
          : {}),
        ...(trimmedSearch
          ? {
              OR: [
                {
                  storeName: {
                    contains: trimmedSearch,
                    mode: 'insensitive',
                  },
                },
                {
                  storeDescription: {
                    contains: trimmedSearch,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      };

      const [allCategories, vendors] = await Promise.all([
        this.prisma.category.findMany({
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            slug: true,
            parentId: true,
            path: true,
          },
        }),
        this.prisma.vendor.findMany({
          where,
          select: {
            ...vendorSelect,
            products: {
              where: { isDeleted: false, isActive: true },
              select: {
                category: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    path: true,
                  },
                },
              },
            },
          },
          ...(limit ? { take: limit } : {}),
          orderBy: {
            storeName: 'asc',
          },
        }),
      ]);

      const catById = new Map(allCategories.map((c) => [c.id, c]));
      const rootBySlug = new Map(
        allCategories.filter((c) => !c.parentId).map((c) => [c.slug, c]),
      );

      const findRootCategory = (
        catId?: string | null,
        catSlug?: string | null,
        catPath?: string | null,
      ) => {
        if (catId) {
          let current = catById.get(catId);
          while (current && current.parentId) {
            const parent = catById.get(current.parentId);
            if (!parent) break;
            current = parent;
          }
          if (current && !current.parentId) return current;
        }
        const cleanPath = (catPath || catSlug || '').replace(/^\/+/, '');
        const rootSlug = cleanPath.split('/')[0];
        if (rootSlug) {
          const root = rootBySlug.get(rootSlug);
          if (root) return root;
        }
        return null;
      };

      return vendors.map((vendor) => {
        const catMap = new Map<
          string,
          { id: string; name: string; slug: string }
        >();
        for (const p of vendor.products || []) {
          if (p.category) {
            const root = findRootCategory(
              p.category.id,
              p.category.slug,
              p.category.path,
            );
            if (root && !catMap.has(root.id)) {
              catMap.set(root.id, {
                id: root.id,
                name: root.name,
                slug: root.slug,
              });
            }
          }
        }
        return this.toVendorProfile(vendor, Array.from(catMap.values()));
      });
    });
  }

  async findStoreBySlug(storeSlug: string): Promise<VendorProfileDto> {
    return this.cacheService.wrapStale(
      VENDOR_STORE(storeSlug),
      VENDOR_STORE_TTL,
      async () => {
        const [allCategories, vendor] = await Promise.all([
          this.prisma.category.findMany({
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              slug: true,
              parentId: true,
              path: true,
            },
          }),
          this.prisma.vendor.findUnique({
            where: {
              storeSlug,
            },
            select: {
              ...vendorSelect,
              products: {
                where: {
                  isDeleted: false,
                  isActive: true,
                },
                take: 100,
                select: {
                  category: {
                    select: {
                      id: true,
                      name: true,
                      slug: true,
                      path: true,
                    },
                  },
                },
              },
            },
          }),
        ]);

        if (!vendor || !vendor.isActive || !vendor.isApproved) {
          throw new NotFoundException('Store not found');
        }

        const catById = new Map(allCategories.map((c) => [c.id, c]));
        const rootBySlug = new Map(
          allCategories.filter((c) => !c.parentId).map((c) => [c.slug, c]),
        );

        const findRootCategory = (
          catId?: string | null,
          catSlug?: string | null,
          catPath?: string | null,
        ) => {
          if (catId) {
            let current = catById.get(catId);
            while (current && current.parentId) {
              const parent = catById.get(current.parentId);
              if (!parent) break;
              current = parent;
            }
            if (current && !current.parentId) return current;
          }
          const cleanPath = (catPath || catSlug || '').replace(/^\/+/, '');
          const rootSlug = cleanPath.split('/')[0];
          if (rootSlug) {
            const root = rootBySlug.get(rootSlug);
            if (root) return root;
          }
          return null;
        };

        const catMap = new Map<
          string,
          { id: string; name: string; slug: string }
        >();
        for (const p of vendor.products || []) {
          if (p.category) {
            const root = findRootCategory(
              p.category.id,
              p.category.slug,
              p.category.path,
            );
            if (root && !catMap.has(root.id)) {
              catMap.set(root.id, {
                id: root.id,
                name: root.name,
                slug: root.slug,
              });
            }
          }
        }

        return this.toVendorProfile(vendor, Array.from(catMap.values()));
      },
    );
  }

  async findStoreProducts(storeSlug: string): Promise<{
    store: VendorProfileDto;
    products: any[];
  }> {
    return this.cacheService.wrapStale(
      VENDOR_STORE_PRODUCTS(storeSlug),
      VENDOR_STORE_TTL,
      async () => {
        const vendor = await this.prisma.vendor.findUnique({
          where: {
            storeSlug,
          },
          select: {
            ...vendorSelect,
            products: {
              where: {
                isDeleted: false,
                isActive: true,
              },
              take: 100,
              select: storeProductSelect,
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        });

        if (!vendor || !vendor.isActive || !vendor.isApproved) {
          throw new NotFoundException('Store not found');
        }

        const { products, ...storeData } = vendor;

        const catMap = new Map<
          string,
          { id: string; name: string; slug: string }
        >();
        const formattedProducts = products.map((p) => {
          const hierarchy = resolveCategoryHierarchy(p.category);
          if (hierarchy.category && hierarchy.category.id) {
            catMap.set(hierarchy.category.id, hierarchy.category);
          }
          return {
            ...p,
            category: hierarchy.category,
            parentSubcategory: hierarchy.parentSubcategory ?? null,
            subcategory: hierarchy.subcategory ?? null,
            leafCategory: p.category
              ? {
                  id: p.category.id,
                  name: p.category.name,
                  slug: p.category.slug,
                }
              : null,
          };
        });

        return {
          store: this.toVendorProfile(storeData, Array.from(catMap.values())),
          products: formattedProducts,
        };
      },
    );
  }

  private async getVendorOrThrow(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: {
        id: vendorId,
      },
      select: {
        id: true,
        storeName: true,
        email: true,
        storeSlug: true,
        isActive: true,
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    return vendor;
  }

  private toVendorProfile(
    vendor: VendorSelectPayload,
    categories?: Array<{ id: string; name: string; slug: string }>,
  ): VendorProfileDto {
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
      ...(categories ? { categories } : {}),
    };
  }

  async resetPassword(
    dto: VendorResetPasswordDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const vendor = await this.prisma.vendor.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        firstName: true,
      },
    });

    if (!vendor) {
      throw new BadRequestException('Invalid email or reset code');
    }

    await this.otpService.verifyOtp(
      normalizedEmail,
      dto.otpCode,
      'password-reset',
    );

    const hashedPassword = await bcrypt.hash(
      dto.newPassword,
      BCRYPT_COST_FACTOR,
    );

    await this.prisma.vendor.update({
      where: {
        id: vendor.id,
      },
      data: {
        password: hashedPassword,
        refreshToken: null,
        refreshTokenId: null,
        tokenVersion: { increment: 1 },
      },
    });

    // Invalidate Redis stamp so old access tokens fail immediately
    await this.refreshSessionService.revokeSession(vendor.id, ROLE.VENDOR);

    await this.auditLog.log({
      action: 'VENDOR_RESET_PASSWORD',
      entity: 'Vendor',
      entityId: vendor.id,
      ipAddress,
      userAgent,
    });

    void this.emailService
      .sendPasswordResetSuccessEmail(dto.email, vendor.firstName ?? '')
      .catch((error) => {
        this.logger.error(
          'Failed to send password reset confirmation email',
          error,
        );
      });
  }

  async logout(
    vendorId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<void> {
    // Consolidated revocation: clears DB tokens + invalidates Redis stamp
    await this.refreshSessionService.revokeSession(vendorId, ROLE.VENDOR);

    await this.auditLog.log({
      action: 'VENDOR_LOGOUT',
      entity: 'Vendor',
      entityId: vendorId,
      ipAddress,
      userAgent,
    });
  }

  async refresh(
    vendorId: string,
    expectedRefreshId: string,
  ): Promise<VendorSession> {
    // Delegate to consolidated refresh logic which provides:
    // - grace period for concurrent requests
    // - token reuse detection with session revocation
    // - timing-safe hash verification
    const session = await this.refreshSessionService.refresh({
      sub: vendorId,
      role: ROLE.VENDOR,
      refreshId: expectedRefreshId,
    });

    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: vendorSelect,
    });

    if (!vendor) {
      throw new UnauthorizedException('Vendor not found');
    }

    return {
      profile: this.toVendorProfile(vendor),
      tokens: session.tokens,
    };
  }
}

// vendors.service.ts

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import {
  resolveCategoryHierarchy,
  type CategorySummaryRef,
} from '@api/modules/products/products.service';
import {
  AuditLogService,
  toAuditPayload,
  type AuditChanges,
} from '@api/common/audit-log/audit-log.service';
import { UNKNOWN_ACCOUNT_PASSWORD_HASH } from '@api/common/constants/bcrypt.constants';
import {
  VENDOR_STORE,
  VENDOR_STORE_PRODUCTS,
  VENDOR_STORE_TTL,
} from '@api/common/constants/cache.constant';
import { generateSlug } from '@api/common/utils/slug.util';
import { getStockStatus } from '@api/common/utils/stock-status.util';

import { UpdateVendorDto } from './dto/update-vendor.dto';
import { VendorReactivateDto } from './dto/vendor-reactivate.dto';
import { FeaturedVendorDto, VendorProfileDto } from './dto/vendor-response.dto';
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
  avatarUrl: true,
  authProvider: true,
} as const;

type StoreProductRecord = Prisma.ProductGetPayload<{
  select: typeof storeProductSelect;
}>;

type StoreProductSummary = Omit<StoreProductRecord, 'category'> & {
  category: CategorySummaryRef;
  parentSubcategory?: CategorySummaryRef | null;
  subcategory?: CategorySummaryRef | null;
  leafCategory: { id: string; name: string; slug: string } | null;
};

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

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly cacheService: CacheService,
  ) {}

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
        avatarUrl: true,
        authProvider: true,
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

    const isPasswordValid = vendor.password
      ? await bcrypt.compare(dto.password, vendor.password)
      : false;

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
        avatarUrl: true,
        authProvider: true,
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

  async findFeaturedPublicVendors(
    requestedLimit = 8,
  ): Promise<FeaturedVendorDto[]> {
    const limit = Math.min(12, Math.max(1, Math.floor(requestedLimit || 8)));
    const vendors = await this.prisma.vendor.findMany({
      where: {
        isActive: true,
        isApproved: true,
        products: {
          some: {
            isActive: true,
            isDeleted: false,
            OR: [
              { stock: { gt: 0 } },
              {
                variants: {
                  some: { isActive: true, isDeleted: false, stock: { gt: 0 } },
                },
              },
            ],
            images: { some: {} },
          },
        },
      },
      orderBy: [{ isVerified: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: Math.min(60, limit * 3),
      select: {
        id: true,
        storeName: true,
        storeSlug: true,
        storeDescription: true,
        storeLogoUrl: true,
        isVerified: true,
        createdAt: true,
        products: {
          where: {
            isActive: true,
            isDeleted: false,
            OR: [
              { stock: { gt: 0 } },
              {
                variants: {
                  some: { isActive: true, isDeleted: false, stock: { gt: 0 } },
                },
              },
            ],
            images: { some: {} },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 4,
          select: {
            id: true,
            name: true,
            slug: true,
            price: true,
            stock: true,
            hasVariants: true,
            variants: {
              where: { isActive: true, isDeleted: false },
              select: { stock: true },
            },
            images: {
              orderBy: { position: 'asc' },
              take: 1,
              select: { url: true },
            },
          },
        },
      },
    });

    return vendors
      .map((vendor) => ({
        id: vendor.id,
        storeName: vendor.storeName,
        storeSlug: vendor.storeSlug,
        storeDescription: vendor.storeDescription,
        storeLogoUrl: vendor.storeLogoUrl,
        isVerified: vendor.isVerified,
        createdAt: vendor.createdAt,
        featuredProducts: vendor.products.map((product) => {
          const totalStock = product.hasVariants
            ? product.variants.reduce(
                (total, variant) => total + variant.stock,
                0,
              )
            : product.stock;
          const { stockStatus } = getStockStatus(totalStock, true);

          return {
            id: product.id,
            name: product.name,
            slug: product.slug,
            price: Number(product.price),
            discountPrice: null,
            thumbnail: product.images[0]?.url ?? null,
            stockStatus,
            hasVariants: product.hasVariants,
            vendor: {
              id: vendor.id,
              storeName: vendor.storeName,
              storeSlug: vendor.storeSlug,
              storeLogoUrl: vendor.storeLogoUrl ?? undefined,
              isVerified: vendor.isVerified,
            },
          };
        }),
      }))
      .filter((vendor) => vendor.featuredProducts.length >= 2)
      .slice(0, limit);
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
    products: StoreProductSummary[];
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
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';

import {
  PRODUCT_BY_SLUG,
  PRODUCT_TTL,
  VENDOR_STORE_PRODUCTS,
} from '@api/common/constants/cache.constants';

import { resolveCategoryIdFromPath } from '@api/common/utils/category-path.util';
import { mapPrismaError } from '@api/common/utils/prisma-error.util';
import { generateSlug } from '@api/common/utils/slug.util';
import { getStockStatus } from '@api/common/utils/stock-status.util';

import { createPaginationMeta } from '@api/common/utils/pagination-meta.util';
import { getPagination } from '@api/common/utils/pagination.util';

import {
  buildCursorMeta,
  getCursorPagination,
} from '@api/common/utils/cursor-pagination.util';

import { AuditLogService } from '@api/modules/audit/services/audit-log.service';
import { SearchService } from '@api/modules/search/services/search.service';

import { AdminCreateProductDto } from '../dto/admin-create-product.dto';
import { AdminProductResponseDto } from '../dto/admin-product-response.dto';
import { CreateProductDto } from '../dto/create-product.dto';
import { ProductReactivateResponseDto } from '../dto/product-reactivate-response.dto';
import { ProductResponseDto } from '../dto/product-response.dto';
import { QueryProductDto } from '../dto/query-product.dto';
import { StockUpdateResponseDto } from '../dto/stock-update-response.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { VendorProductResponseDto } from '../dto/vendor-product-response.dto';

import type { CreateVariantDto } from '@api/modules/products/dto/create-variant.dto';
import { auditDetails } from '@api/modules/audit/utils/audit-details.util';
import {
  adminListInclude,
  buildProductCursorWhere,
  productCursorPayload,
  productInclude,
  resolveProductOrderBy,
  vendorProductInclude,
} from '../utils/product-includes.util';
import {
  normalizeImageUrls,
  normalizeSearch,
  toAdminResponse,
  toResponse,
  toVendorResponse,
} from '../utils/product-response.mapper';
import { claimStockAdjustment } from '../utils/stock-adjustment-claim.util';
import { ProductCategoryResolverService } from './product-category-resolver.service';

/* ============================================================================
 * SERVICE
 * ========================================================================== */

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRunnerService,
    private readonly cacheService: CacheService,
    private readonly searchService: SearchService,
    private readonly auditLog: AuditLogService,
    private readonly categories: ProductCategoryResolverService,
  ) {}

  /* ==========================================================================
   * CREATE
   * ======================================================================== */

  /**
   * Create a product through the admin API.
   */
  async create(dto: AdminCreateProductDto): Promise<ProductResponseDto> {
    if (!dto.vendorId) {
      throw new BadRequestException(
        'vendorId is required when creating a product through admin API',
      );
    }

    const categoryId = await this.categories.resolveCategoryId(dto.categoryId);

    /*
     * Slugs are scoped to the category in this implementation.
     *
     * IMPORTANT:
     * The database must still have a unique constraint such as:
     *
     * @@unique([categoryId, slug])
     *
     * because application-level slug checking cannot completely prevent
     * concurrent requests from generating the same slug.
     */
    const slug = await this.resolveProductSlug(dto.name, categoryId, dto.slug);

    try {
      const imageUrls = normalizeImageUrls(dto.imageUrls, dto.imageUrl);

      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,

          hasVariants: dto.hasVariants ?? false,

          /*
           * A variant product does not maintain product-level stock.
           * Its stock is calculated from its variants.
           */
          stock: dto.hasVariants ? 0 : (dto.stock ?? 0),

          price: dto.price ?? 0,

          sku: dto.sku,
          isActive: dto.isActive ?? true,

          categoryId,
          vendorId: dto.vendorId,

          images:
            imageUrls.length > 0
              ? {
                  create: imageUrls.map((url, index) => ({
                    url,
                    position: index,
                    isPrimary: index === 0,
                  })),
                }
              : undefined,
        },

        include: productInclude,
      });

      if (dto.hasVariants && dto.variants && dto.variants.length > 0) {
        await this.createInitialVariants(product.id, dto.variants);
      }

      const freshProduct =
        dto.hasVariants && dto.variants && dto.variants.length > 0
          ? await this.prisma.product.findUnique({
              where: { id: product.id },
              include: productInclude,
            })
          : product;

      const response = toResponse(freshProduct || product);

      /*
       * Product creation invalidates:
       * - exact product cache
       * - public product listings
       * - vendor store listing
       */
      await this.invalidateProductCaches({
        id: product.id,
        slugs: [product.slug],
        vendorStoreSlug: product.vendor.storeSlug,
      });

      auditDetails({
        entityId: product.id,
        payload: {
          name: product.name,
          sku: product.sku,
          vendorId: product.vendor.id,
        },
      });

      return response;
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /**
   * Create a product from a vendor account.
   */
  async createForVendor(
    vendorId: string,
    dto: CreateProductDto,
  ): Promise<VendorProductResponseDto> {
    const categoryId = await this.categories.resolveCategoryId(dto.categoryId);

    const slug = await this.resolveProductSlug(dto.name, categoryId, dto.slug);

    try {
      const imageUrls = normalizeImageUrls(dto.imageUrls, dto.imageUrl);

      const product = await this.prisma.product.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,

          hasVariants: dto.hasVariants ?? false,
          stock: dto.hasVariants ? 0 : (dto.stock ?? 0),
          price: dto.price ?? 0,

          sku: dto.sku,
          isActive: dto.isActive ?? true,

          categoryId,
          vendorId,

          images:
            imageUrls.length > 0
              ? {
                  create: imageUrls.map((url, index) => ({
                    url,
                    position: index,
                    isPrimary: index === 0,
                  })),
                }
              : undefined,
        },

        include: vendorProductInclude,
      });

      if (dto.hasVariants && dto.variants && dto.variants.length > 0) {
        await this.createInitialVariants(product.id, dto.variants);
      }

      const freshProduct =
        dto.hasVariants && dto.variants && dto.variants.length > 0
          ? await this.prisma.product.findUnique({
              where: { id: product.id },
              include: vendorProductInclude,
            })
          : product;

      const response = toVendorResponse(freshProduct || product);

      await this.invalidateProductCaches({
        id: product.id,
        slugs: [product.slug],
        vendorStoreSlug: product.vendor.storeSlug,
      });

      auditDetails({
        entityId: product.id,
        payload: {
          name: product.name,
          sku: product.sku,
          vendorId,
        },
      });

      return response;
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /* ==========================================================================
   * PUBLIC READS
   * ======================================================================== */

  /**
   * Returns the authenticated vendor's products.
   */
  async findAllForVendor(
    vendorId: string,
    query: QueryProductDto,
  ): Promise<{
    data: VendorProductResponseDto[];
    meta: ReturnType<typeof createPaginationMeta>;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 10), 50);

    const where = await this.buildListWhere(query, {
      vendorId,
      defaultDeleted: false,
    });

    const [total, products, categoryMap] = await Promise.all([
      this.prisma.product.count({
        where,
      }),

      this.prisma.product.findMany({
        where,
        include: vendorProductInclude,
        orderBy: [
          {
            createdAt: 'desc',
          },
          {
            id: 'desc',
          },
        ],
        ...getPagination(page, limit),
      }),

      this.categories.getCategoryLookupMap(),
    ]);

    return {
      data: products.map((product) => toVendorResponse(product, categoryMap)),
      meta: createPaginationMeta(total, page, limit),
    };
  }

  /**
   * Retrieves a product only when it belongs to the vendor.
   *
   * Ownership is enforced in SQL rather than fetching first and checking
   * ownership afterwards.
   */
  async findOneForVendor(
    slug: string,
    vendorId: string,
  ): Promise<VendorProductResponseDto> {
    const product = await this.prisma.product.findFirst({
      where: {
        slug: slug.trim(),
        vendorId,
        isDeleted: false,
      },
      include: vendorProductInclude,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return toVendorResponse(product);
  }

  /* ==========================================================================
   * ADMIN READS
   * ======================================================================== */

  /**
   * Admin product listing.
   *
   * Supports both:
   * - cursor pagination
   * - traditional page pagination
   */
  async findAllForAdmin(query: QueryProductDto): Promise<{
    data: AdminProductResponseDto[];
    meta:
      | ReturnType<typeof createPaginationMeta>
      | ReturnType<typeof buildCursorMeta>;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 10), 100);

    const where = await this.buildListWhere(query, {
      /*
       * Admin listing defaults to non-deleted products unless the caller
       * explicitly requests another value through isDeleted.
       */
      defaultDeleted: false,
    });

    /* ------------------------------------------------------------------------
     * Cursor pagination
     * ---------------------------------------------------------------------- */

    if (query.cursor !== undefined) {
      const { take, decodedCursor } = getCursorPagination(limit, query.cursor);
      if (!decodedCursor) {
        throw new BadRequestException('Invalid product cursor.');
      }

      if (decodedCursor) {
        const cursorWhere = buildProductCursorWhere(decodedCursor, query.sort);

        /*
         * FIXED:
         *
         * The old implementation spread an array into `where`.
         *
         * Cursor conditions must be placed inside AND.
         */
        const existingAnd = Array.isArray(where.AND)
          ? where.AND
          : where.AND
            ? [where.AND]
            : [];

        where.AND = [...existingAnd, { OR: cursorWhere }];
      }

      const [products, categoryMap] = await Promise.all([
        this.prisma.product.findMany({
          where,
          include: adminListInclude,
          orderBy: resolveProductOrderBy(query.sort),
          take,
        }),
        this.categories.getCategoryLookupMap(),
      ]);

      const meta = buildCursorMeta(products, limit, (last) =>
        productCursorPayload(last, query.sort),
      );

      return {
        data: products
          .slice(0, limit)
          .map((product) => toAdminResponse(product, categoryMap)),
        meta,
      };
    }

    /* ------------------------------------------------------------------------
     * Traditional pagination
     * ---------------------------------------------------------------------- */

    const [total, products, categoryMap] = await Promise.all([
      this.prisma.product.count({
        where,
      }),

      this.prisma.product.findMany({
        where,
        include: adminListInclude,
        orderBy: resolveProductOrderBy(query.sort),
        ...getPagination(page, limit),
      }),

      this.categories.getCategoryLookupMap(),
    ]);

    return {
      data: products.map((product) => toAdminResponse(product, categoryMap)),
      meta: createPaginationMeta(total, page, limit),
    };
  }

  /**
   * Admin lookup by product ID.
   *
   * Unlike public/vendor reads, deleted and inactive products are allowed.
   */
  async findOneForAdmin(id: string): Promise<AdminProductResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: {
        id,
      },
      include: productInclude,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return toAdminResponse(product);
  }

  /**
   * Returns stock adjustment history.
   */
  async getStockHistory(productId: string, take = 50) {
    const safeTake = Math.min(Math.max(1, take), 100);

    const product = await this.prisma.product.findUnique({
      where: {
        id: productId,
      },
      select: {
        id: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const history = await this.prisma.stockHistory.findMany({
      where: {
        productId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: safeTake,
    });

    return history.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      adjustment: item.adjustment,
      oldStockQuantity: item.oldStockQuantity,
      newStockQuantity: item.newStockQuantity,
      description: item.description,
      createdAt: item.createdAt,
    }));
  }

  /* ==========================================================================
   * STOCK
   * ======================================================================== */

  /**
   * Atomically adjusts product-level stock and writes the stock history entry
   * in the SAME transaction.
   *
   * Variant products are rejected because their stock belongs to variants.
   */
  async updateStock(
    id: string,
    quantity: number,
    userId?: string,
    description?: string,
    requestId?: string,
  ): Promise<StockUpdateResponseDto> {
    if (!Number.isInteger(quantity)) {
      throw new BadRequestException(
        'Stock adjustment quantity must be an integer',
      );
    }

    /*
     * The adjustment of zero is technically harmless, but treating it as a
     * no-op prevents unnecessary DB writes and audit records.
     */
    if (quantity === 0) {
      const product = await this.prisma.product.findFirst({
        where: {
          id,
          isDeleted: false,
        },
        select: {
          id: true,
          slug: true,
          stock: true,
          updatedAt: true,
          hasVariants: true,
        },
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      if (product.hasVariants) {
        throw new BadRequestException(
          'Stock is managed at the variant level for variant products. Use the variant stock endpoint instead.',
        );
      }

      const { inStock, stockStatus } = getStockStatus(product.stock, true);

      return {
        id: product.id,
        slug: product.slug,
        stock: product.stock,
        inStock,
        stockStatus,
        updatedAt: product.updatedAt,
      };
    }

    try {
      const result = await this.transactions.run(
        async ({ tx }) => {
          /*
           * Fetch only fields required for validation.
           */
          const product = await tx.product.findFirst({
            where: {
              id,
              isDeleted: false,
            },
            select: {
              id: true,
              slug: true,
              stock: true,
              hasVariants: true,
              vendor: {
                select: {
                  storeSlug: true,
                },
              },
            },
          });

          if (!product) {
            throw new NotFoundException('Product not found');
          }

          if (product.hasVariants) {
            throw new BadRequestException(
              'Stock is managed at the variant level for variant products. Use the variant stock endpoint instead.',
            );
          }

          /*
           * A repeat of an adjustment already applied (same request id) changes nothing and
           * answers with the stock as it is now.
           */
          if (!(await claimStockAdjustment(tx, requestId))) {
            const current = await tx.product.findUniqueOrThrow({
              where: { id },
              select: { id: true, slug: true, stock: true, updatedAt: true },
            });
            return {
              product,
              updated: current,
              oldStock: current.stock,
              replayed: true,
            };
          }

          /*
           * The UPDATE is guarded when decreasing stock.
           *
           * This prevents:
           *
           * currentStock = 2
           * quantity = -5
           *
           * from ever producing -3.
           *
           * The database performs the increment/decrement atomically.
           */
          const updatedCount = await tx.product.updateMany({
            where: {
              id,
              isDeleted: false,

              ...(quantity < 0
                ? {
                    stock: {
                      gte: -quantity,
                    },
                  }
                : {}),
            },

            data: {
              stock: {
                increment: quantity,
              },
            },
          });

          if (updatedCount.count !== 1) {
            throw new BadRequestException(
              `Insufficient stock: cannot apply ${quantity} to the current stock level`,
            );
          }

          /*
           * This SELECT occurs inside the same transaction after the atomic
           * update. The returned stock is therefore the value produced by
           * this adjustment.
           */
          const updated = await tx.product.findUniqueOrThrow({
            where: {
              id,
            },
            select: {
              id: true,
              slug: true,
              stock: true,
              updatedAt: true,
            },
          });

          /*
           * Deriving oldStock from the resulting value + adjustment avoids
           * relying on a stale pre-transaction read.
           *
           * newStock = oldStock + quantity
           * oldStock = newStock - quantity
           */
          const oldStock = updated.stock - quantity;

          await tx.stockHistory.create({
            data: {
              productId: id,
              adjustment: quantity,
              oldStockQuantity: oldStock,
              newStockQuantity: updated.stock,
              description:
                description ??
                (quantity > 0
                  ? 'Manual stock adjustment'
                  : 'Manual stock reduction'),
              createdBy: userId,
            },
          });

          return {
            product,
            updated,
            oldStock,
            replayed: false,
          };
        },
        { name: 'product.update-stock' },
      );

      const { updated, oldStock, product, replayed } = result;

      const { inStock, stockStatus } = getStockStatus(updated.stock, true);

      const response: StockUpdateResponseDto = {
        id: updated.id,
        slug: updated.slug,
        stock: updated.stock,
        inStock,
        stockStatus,
        updatedAt: updated.updatedAt,
      };

      if (replayed) {
        // Already applied by the request with this id: nothing changed, so nothing to clear or audit.
        auditDetails({
          entityId: id,
          payload: { replayed: true, requestId },
        });
        return response;
      }

      /*
       * Cache invalidation happens AFTER the transaction has committed.
       *
       * This prevents invalidating caches for a DB operation that later rolls
       * back.
       */
      await this.invalidateProductCaches({
        id: updated.id,
        slugs: [updated.slug],
        vendorStoreSlug: product.vendor?.storeSlug,
      });

      auditDetails({
        entityId: id,
        payload: {
          previousStock: oldStock,
          newStock: updated.stock,
          adjustment: quantity,
        },
      });

      return response;
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /* ==========================================================================
   * UPDATE
   * ======================================================================== */

  /**
   * Updates an existing product.
   *
   * Handles:
   * - category validation
   * - category changes
   * - slug regeneration
   * - slug uniqueness
   * - variant/product stock rules
   * - primary image replacement
   * - cache invalidation
   * - audit logging
   */
  async update(
    id: string,
    dto: UpdateProductDto,
  ): Promise<AdminProductResponseDto> {
    const existing = await this.findActiveProductOrThrow(id);

    const {
      slug: slugInput,
      name,
      imageUrl,
      imageUrls,
      variants,
      categoryId: nextCategoryId,
      ...rest
    } = dto;
    void variants;

    const data: Prisma.ProductUpdateInput = {
      ...rest,
    };

    /*
     * Keep track of the ACTUAL category that the resulting product will use.
     *
     * This is important because slug uniqueness is scoped to category.
     */
    let resolvedCategoryId = existing.categoryId;

    /* ------------------------------------------------------------------------
     * Category
     * ---------------------------------------------------------------------- */

    if (
      nextCategoryId !== undefined &&
      nextCategoryId !== existing.categoryId
    ) {
      resolvedCategoryId =
        await this.categories.resolveCategoryId(nextCategoryId);

      data.category = {
        connect: {
          id: resolvedCategoryId,
        },
      };
    }

    /* ------------------------------------------------------------------------
     * Variant stock rules
     * ---------------------------------------------------------------------- */

    /*
     * Once a product becomes a variant product, its direct stock must be zero.
     */
    if (dto.hasVariants === true && !existing.hasVariants) {
      data.stock = 0;
    }

    /*
     * Prevent accidentally leaving product-level stock active when an existing
     * variant product remains a variant product.
     */
    if (
      dto.hasVariants === true ||
      (dto.hasVariants === undefined && existing.hasVariants)
    ) {
      data.stock = 0;
    }

    /* ------------------------------------------------------------------------
     * Slug
     * ---------------------------------------------------------------------- */

    let nextSlug: string | undefined;

    /*
     * Explicit slug supplied.
     */
    if (slugInput?.trim()) {
      nextSlug = await this.resolveProductSlug(
        name ?? existing.name,
        resolvedCategoryId,
        slugInput,
        id,
      );
    } else if (name !== undefined || nextCategoryId !== undefined) {
      /*
       * Name changed without an explicit slug.
       *
       * Generate a new slug from the new name.
       */
      nextSlug = await this.resolveProductSlug(
        name ?? existing.name,
        resolvedCategoryId,
        undefined,
        id,
      );
    }

    if (nextSlug !== undefined) {
      data.slug = nextSlug;
    }

    /* ------------------------------------------------------------------------
     * Primary image & Image list order
     * ---------------------------------------------------------------------- */

    if (imageUrls !== undefined) {
      const normalizedImages = normalizeImageUrls(imageUrls, imageUrl);

      // Remove existing non-variant images so the new order/selection applies
      await this.prisma.productImage.deleteMany({
        where: {
          productId: id,
          variantId: null,
        },
      });

      if (normalizedImages.length > 0) {
        data.images = {
          create: normalizedImages.map((url, index) => ({
            url,
            position: index,
            isPrimary: index === 0,
          })),
        };
      }
    } else if (imageUrl !== undefined) {
      data.images = {
        updateMany: {
          where: {
            isPrimary: true,
          },
          data: {
            isPrimary: false,
          },
        },

        create: {
          url: imageUrl,
          isPrimary: true,
          position: 0,
        },
      };
    }

    try {
      const updated = await this.prisma.product.update({
        where: {
          id,
        },
        data,
        include: productInclude,
      });

      const response = toAdminResponse(updated);

      /*
       * Invalidate BOTH old and new slug caches when the slug changes.
       */
      const slugsToInvalidate =
        updated.slug !== existing.slug
          ? [existing.slug, updated.slug]
          : [updated.slug];

      await this.invalidateProductCaches({
        id: updated.id,
        slugs: slugsToInvalidate,
        vendorStoreSlug: updated.vendor.storeSlug,
      });

      auditDetails({
        entityId: id,
        payload: {
          changes: JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonValue,
        },
      });

      return response;
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /* ==========================================================================
   * STATUS
   * ======================================================================== */

  /**
   * Soft-deactivates a product.
   */
  async deactivate(id: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        slug: true,
        isActive: true,
        vendor: {
          select: {
            storeSlug: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    /*
     * Idempotent operation:
     * if already inactive, no unnecessary DB update occurs.
     */
    if (product.isActive) {
      await this.prisma.product.updateMany({
        where: {
          id,
          isDeleted: false,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });
    }

    await this.invalidateProductCaches({
      id: product.id,
      slugs: [product.slug],
      vendorStoreSlug: product.vendor?.storeSlug,
    });

    auditDetails({
      entityId: id,
      payload: {
        name: product.name,
        sku: product.sku,
      },
    });
  }

  /**
   * Reactivates a product.
   *
   * A deleted product is not restored by this method; restore() handles
   * soft-deleted products.
   */
  async reactivate(id: string): Promise<ProductReactivateResponseDto> {
    const product = await this.prisma.product.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        isDeleted: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.isDeleted) {
      throw new BadRequestException(
        'Deleted products must be restored before they can be activated',
      );
    }

    const updated = await this.prisma.product.update({
      where: {
        id,
      },
      data: {
        isActive: true,
      },
      select: {
        id: true,
        slug: true,
        isActive: true,
        updatedAt: true,
        vendor: {
          select: {
            storeSlug: true,
          },
        },
      },
    });

    await this.invalidateProductCaches({
      id: updated.id,
      slugs: [updated.slug],
      vendorStoreSlug: updated.vendor?.storeSlug,
    });

    auditDetails({
      entityId: id,
      payload: {
        name: product.name,
        sku: product.sku,
      },
    });

    return updated;
  }

  /**
   * Permanently deletes a product.
   *
   * Foreign-key failures are mapped through mapPrismaError().
   */
  async permanentRemove(id: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        slug: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    try {
      await this.prisma.product.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      mapPrismaError(error);
    }

    await this.invalidateProductCaches({
      id: product.id,
      slugs: [product.slug],
    });

    auditDetails({
      entityId: id,
      payload: {
        name: product.name,
        sku: product.sku,
      },
    });
  }

  /**
   * Restores a soft-deleted product.
   */
  async restore(id: string, userId?: string): Promise<ProductResponseDto> {
    const existing = await this.prisma.product.findUnique({
      where: {
        id,
      },
    });

    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (!existing.isDeleted) {
      throw new BadRequestException('Product is not deleted');
    }

    /*
     * Re-check slug uniqueness because another product could have occupied
     * the old category/slug combination while this product was deleted.
     */
    const slug = await this.resolveProductSlug(
      existing.name,
      existing.categoryId,
      existing.slug,
      existing.id,
    );

    try {
      const updated = await this.prisma.product.update({
        where: {
          id,
        },
        data: {
          slug,
          isDeleted: false,
          isActive: true,
          deletedAt: null,
        },
        include: productInclude,
      });

      const response = toResponse(updated);

      await this.invalidateProductCaches({
        id: updated.id,
        slugs: [existing.slug, updated.slug],
        vendorStoreSlug: updated.vendor.storeSlug,
      });

      await this.auditLog.log({
        action: 'RESTORE_PRODUCT',
        entity: 'Product',
        entityId: id,
        adminId: userId,
        userId,
        payload: {
          name: existing.name,
          sku: existing.sku,
        },
      });

      return response;
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /* ==========================================================================
   * LEGACY METHODS
   * ======================================================================== */

  /**
   * @deprecated Use findOnePublic(slug) for public slug lookup.
   */
  async findOne(id: string): Promise<ProductResponseDto> {
    const cacheKey = `product:id:${id}`;

    const cached = await this.cacheService.get<ProductResponseDto>(cacheKey);

    if (cached) {
      return cached;
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id,
        isDeleted: false,
        isActive: true,
      },
      include: productInclude,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const response = toResponse(product);

    /*
     * Keep the old ID cache and slug cache populated for backwards
     * compatibility with existing consumers.
     */
    await Promise.all([
      this.cacheService.set(cacheKey, response, PRODUCT_TTL),

      this.cacheService.set(
        `product:slug:${product.slug}`,
        response,
        PRODUCT_TTL,
      ),
    ]);

    return response;
  }

  /**
   * @deprecated Use findOneForVendor().
   */
  async findBySlugForVendor(
    vendorId: string,
    slug: string,
  ): Promise<ProductResponseDto> {
    return this.findOneForVendor(
      slug,
      vendorId,
    ) as unknown as Promise<ProductResponseDto>;
  }

  /**
   * @deprecated Use findAllForAdmin().
   */
  async findAll(query: QueryProductDto): Promise<{
    data: AdminProductResponseDto[];
    meta:
      | ReturnType<typeof createPaginationMeta>
      | ReturnType<typeof buildCursorMeta>;
  }> {
    return this.findAllForAdmin(query);
  }

  /**
   * @deprecated Use findAllForVendor().
   */
  async findAllByVendor(
    vendorId: string,
    query: QueryProductDto,
  ): Promise<{
    data: VendorProductResponseDto[];
    meta: ReturnType<typeof createPaginationMeta>;
  }> {
    return this.findAllForVendor(vendorId, query);
  }

  /* ==========================================================================
   * PRIVATE PRODUCT HELPERS
   * ======================================================================== */

  /**
   * Creates initial variants for a product during creation.
   */
  private async createInitialVariants(
    productId: string,
    variants: CreateVariantDto[],
  ): Promise<void> {
    for (const variant of variants) {
      const names = new Set<string>();
      const normalized = (variant.options || [])
        .map((opt) => {
          const name = opt.name?.trim();
          const value = opt.value?.trim();
          if (!name || names.has(name)) return null;
          names.add(name);
          return { name, value };
        })
        .filter((o): o is { name: string; value: string } =>
          Boolean(o && o.name && o.value),
        )
        .sort((a, b) => a.name.localeCompare(b.name));

      if (normalized.length === 0) continue;

      const optionsKey = normalized
        .map((opt) => `${opt.name}:${opt.value}`)
        .join('|');

      try {
        await this.prisma.productVariant.create({
          data: {
            productId,
            options: normalized,
            optionsKey,
            stock: Math.max(0, Number(variant.stock) || 0),
            images: Array.isArray(variant.images)
              ? variant.images.filter(Boolean)
              : [],
          },
        });
      } catch {
        // Skip duplicate variant option keys gracefully
      }
    }
  }

  /**
   * Finds a non-deleted product.
   */
  private async findActiveProductOrThrow(id: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        isDeleted: false,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  /**
   * Normalizes and caps product image URLs.
   */
  private async resolveProductSlug(
    name: string,
    categoryId: string,
    explicitSlug?: string,
    excludeProductId?: string,
  ): Promise<string> {
    const base = explicitSlug?.trim()
      ? generateSlug(explicitSlug)
      : generateSlug(name);

    if (!base) {
      throw new BadRequestException(
        'Could not generate a slug; provide a slug or a name with letters or numbers',
      );
    }

    return this.ensureUniqueProductSlug(base, categoryId, excludeProductId);
  }

  /**
   * Finds the first available slug.
   *
   * This reduces the number of DB calls to one.
   *
   * HOWEVER:
   *
   * This is not a substitute for a database UNIQUE constraint.
   *
   * You should have:
   *
   * @@unique([categoryId, slug])
   *
   * in Prisma if slugs are category-scoped.
   */
  private async ensureUniqueProductSlug(
    base: string,
    categoryId: string,
    excludeProductId?: string,
  ): Promise<string> {
    const existing = await this.prisma.product.findMany({
      where: {
        categoryId,

        OR: [
          {
            slug: base,
          },
          {
            slug: {
              startsWith: `${base}-`,
            },
          },
        ],

        ...(excludeProductId
          ? {
              id: {
                not: excludeProductId,
              },
            }
          : {}),
      },

      select: {
        slug: true,
      },
    });

    const taken = new Set(existing.map((product) => product.slug));

    if (!taken.has(base)) {
      return base;
    }

    for (let suffix = 2; ; suffix++) {
      const candidate = `${base}-${suffix}`;

      if (!taken.has(candidate)) {
        return candidate;
      }
    }
  }

  /* ==========================================================================
   * CATEGORY
   * ======================================================================== */

  /**
   * Validates that a product is being assigned to a valid active leaf
   * subcategory.
   */
  private async buildListWhere(
    query: QueryProductDto,
    scope: {
      vendorId?: string;
      defaultDeleted?: boolean;
    },
  ): Promise<Prisma.ProductWhereInput> {
    const {
      search,
      categoryPath,
      categoryId: categoryIdQuery,
      inStock,
      minPrice,
      maxPrice,
      isDeleted,
      isActive,
      vendorId: queryVendorId,
    } = query;

    const where: Prisma.ProductWhereInput = {};

    /* Vendor ownership */
    if (scope.vendorId) {
      where.vendorId = scope.vendorId;
    } else if (queryVendorId) {
      where.vendorId = queryVendorId;
    }

    /* Deleted status */
    if (isDeleted !== undefined) {
      where.isDeleted = isDeleted;
    } else if (scope.defaultDeleted !== undefined) {
      where.isDeleted = scope.defaultDeleted;
    }

    /* Active status (robust boolean parsing) */
    let resolvedIsActive: boolean | undefined = undefined;
    if (typeof isActive === 'boolean') {
      resolvedIsActive = isActive;
    } else if (typeof isActive === 'string') {
      const lower = String(isActive).trim().toLowerCase();
      if (lower === 'true' || lower === '1') resolvedIsActive = true;
      if (lower === 'false' || lower === '0') resolvedIsActive = false;
    }
    if (resolvedIsActive !== undefined) {
      where.isActive = resolvedIsActive;
    }

    /* Search */
    const normalizedSearch = normalizeSearch(search);

    if (normalizedSearch) {
      where.OR = [
        {
          name: {
            contains: normalizedSearch,
            mode: 'insensitive',
          },
        },
        {
          sku: {
            contains: normalizedSearch,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: normalizedSearch,
            mode: 'insensitive',
          },
        },
        {
          slug: {
            contains: normalizedSearch,
            mode: 'insensitive',
          },
        },
        {
          vendor: {
            OR: [
              {
                storeName: { contains: normalizedSearch, mode: 'insensitive' },
              },
              { email: { contains: normalizedSearch, mode: 'insensitive' } },
            ],
          },
        },
        {
          category: {
            name: { contains: normalizedSearch, mode: 'insensitive' },
          },
        },
      ];
    }

    /* Category */
    let targetCatId = categoryIdQuery;
    if (!targetCatId && categoryPath) {
      targetCatId = await resolveCategoryIdFromPath(this.prisma, categoryPath);
    }

    if (targetCatId) {
      const categoryIds =
        await this.categories.collectCategoryAndDescendantIds(targetCatId);

      where.categoryId = {
        in: categoryIds,
      };
    }

    /* Stock */
    if (inStock !== undefined) {
      if (inStock) {
        const stockOr = [
          { stock: { gt: 0 } },
          {
            hasVariants: true,
            variants: {
              some: {
                stock: { gt: 0 },
                isActive: true,
              },
            },
          },
        ];
        if (where.OR) {
          where.AND = [
            ...(Array.isArray(where.AND)
              ? where.AND
              : where.AND
                ? [where.AND]
                : []),
            { OR: stockOr },
          ];
        } else {
          where.OR = stockOr;
        }
      } else {
        where.stock = { lte: 0 };
        where.variants = {
          none: {
            stock: { gt: 0 },
            isActive: true,
          },
        };
      }
    }

    /* Price */
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};

      if (minPrice !== undefined) {
        where.price.gte = minPrice;
      }

      if (maxPrice !== undefined) {
        where.price.lte = maxPrice;
      }
    }

    return where;
  }

  /* ==========================================================================
   * CACHE
   * ======================================================================== */

  /**
   * Centralized product cache invalidation.
   *
   * Exact keys handle product detail pages.
   * Pattern keys handle product listing caches.
   */
  private async invalidateProductCaches(params: {
    slugs?: string[];
    id?: string;
    vendorStoreSlug?: string;
  }): Promise<void> {
    const exactKeys = (params.slugs ?? [])
      .filter(Boolean)
      .flatMap((slug) => [PRODUCT_BY_SLUG(slug), `product:slug:${slug}`]);

    if (params.id) {
      exactKeys.push(`product:id:${params.id}`);
    }

    this.categories.invalidateLookup();

    const operations = [
      ...exactKeys.map((key) => this.cacheService.del(key)),

      /*
       * Both page and cursor public listing caches are invalidated here.
       */
      this.cacheService.delByPattern('product:list:public:*'),

      /*
       * Trending showcase cache.
       */
      this.cacheService.delByPattern('products:trending:*'),

      /*
       * Legacy cache namespace retained for compatibility.
       */
      this.cacheService.delByPattern('products:public:*'),

      /*
       * Invalidate category trees and listings so product counts remain accurate.
       */
      this.cacheService.delByPattern('category:*'),
      this.cacheService.delByPattern('categories:*'),
    ];

    if (params.vendorStoreSlug) {
      operations.push(
        this.cacheService.delByPattern(
          VENDOR_STORE_PRODUCTS(params.vendorStoreSlug),
        ),
      );
    }

    /*
     * All invalidations are independent, so execute them concurrently.
     */
    await Promise.all(operations);
  }
}

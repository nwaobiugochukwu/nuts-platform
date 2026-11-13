import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import {
  CacheKeys,
  CacheService,
} from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';

import {
  CreateVariantDto,
  VariantOptionItemDto,
} from './dto/create-variant.dto';
import { UpdateVariantStockDto } from './dto/update-variant-stock.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

@Injectable()
export class ProductVariantsService {
  private readonly VARIANT_CACHE_TTL = 300;
  private readonly VARIANT_LIST_CACHE_TTL = 120;

  /**
   * Keep database selections explicit.
   *
   * This prevents accidentally loading large product records
   * whenever a variant is requested.
   */
  private readonly productSelect = {
    id: true,
    name: true,
    slug: true,
    hasVariants: true,
    lowStockThreshold: true,
    images: {
      select: {
        url: true,
      },
      orderBy: {
        position: 'asc',
      },
      take: 1,
    },
    vendor: {
      select: {
        id: true,
      },
    },
  } satisfies Prisma.ProductSelect;

  private readonly publicProductSelect = {
    id: true,
    name: true,
    slug: true,
    lowStockThreshold: true,
    images: {
      select: {
        url: true,
      },
      orderBy: {
        position: 'asc',
      },
      take: 1,
    },
  } satisfies Prisma.ProductSelect;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // PUBLIC QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Returns active, non-deleted variants belonging to a public product.
   */
  async findAll(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        isDeleted: false,
        isActive: true,
      },
      select: this.publicProductSelect,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const variants = await this.prisma.productVariant.findMany({
      where: {
        productId,
        isDeleted: false,
        isActive: true,
      },
      orderBy: [
        {
          createdAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    });

    return {
      variants: variants.map((variant) =>
        this.toVariantSummary(variant, product.lowStockThreshold),
      ),
      product: this.toProductReference(product),
    };
  }

  /**
   * Public paginated variant listing.
   */
  async findAllPaginated(page = 1, limit = 20) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.ProductVariantWhereInput = {
      isDeleted: false,
      isActive: true,
      product: {
        isDeleted: false,
        isActive: true,
      },
    };

    const [total, variants] = await this.prisma.$transaction([
      this.prisma.productVariant.count({
        where,
      }),

      this.prisma.productVariant.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: [
          {
            createdAt: 'asc',
          },
          {
            id: 'asc',
          },
        ],
        include: {
          product: {
            select: this.publicProductSelect,
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / safeLimit);

    return {
      data: variants.map((variant) =>
        this.toVariantSummary(variant, variant.product.lowStockThreshold),
      ),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1,
      },
    };
  }

  /**
   * Public single variant lookup.
   */
  async findOne(id: string) {
    const cacheKey = this.cacheService.buildKey(CacheKeys.VARIANT_DETAILS, id);

    return this.cacheService.wrap(
      cacheKey,
      this.VARIANT_CACHE_TTL,
      async () => {
        const variant = await this.prisma.productVariant.findFirst({
          where: {
            id,
            isDeleted: false,
            isActive: true,
            product: {
              isDeleted: false,
              isActive: true,
            },
          },
          include: {
            product: {
              select: this.publicProductSelect,
            },
          },
        });

        if (!variant) {
          throw new NotFoundException('Product variant not found');
        }

        return this.toVariantResponse(
          variant,
          variant.product.lowStockThreshold,
        );
      },
    );
  }

  // ---------------------------------------------------------------------------
  // VENDOR / ADMIN QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Gets all variants belonging to a vendor-owned product.
   *
   * Ownership is checked in the database query itself.
   */
  async findAllForVendor(vendorId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        vendorId,
        isDeleted: false,
      },
      select: this.productSelect,
    });

    if (!product) {
      throw new NotFoundException(
        'Product not found or you do not own this product',
      );
    }

    const variants = await this.prisma.productVariant.findMany({
      where: {
        productId,
        isDeleted: false,
      },
      orderBy: [
        {
          createdAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    });

    return {
      variants: variants.map((variant) =>
        this.toVariantSummary(variant, product.lowStockThreshold),
      ),
      product: this.toProductReference(product),
    };
  }

  /**
   * Admin/vendor single variant lookup.
   */
  async findOneForVendor(vendorId: string, id: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id,
        isDeleted: false,
        product: {
          vendorId,
        },
      },
      include: {
        product: {
          select: this.productSelect,
        },
      },
    });

    if (!variant) {
      throw new NotFoundException(
        'Product variant not found or you do not have access',
      );
    }

    return this.toVariantResponse(variant, variant.product.lowStockThreshold);
  }

  // ---------------------------------------------------------------------------
  // CREATE
  // ---------------------------------------------------------------------------

  async createVariant(productId: string, dto: CreateVariantDto) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        isDeleted: false,
      },
      select: this.productSelect,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (!product.hasVariants) {
      throw new BadRequestException(
        'This product is not configured to use variants',
      );
    }

    const normalizedOptions = this.normalizeOptions(dto.options);

    const optionsKey = this.buildOptionsKey(normalizedOptions);

    try {
      const variant = await this.prisma.productVariant.create({
        data: {
          productId,
          options: normalizedOptions as unknown as Prisma.InputJsonValue,
          optionsKey,
          stock: dto.stock,
          images: dto.images ?? [],
        },
      });

      await this.invalidateVariantCaches(variant.id, productId);

      return this.toVariantResponse(
        {
          ...variant,
          product,
        },
        product.lowStockThreshold,
      );
    } catch (error) {
      this.handlePrismaError(
        error,
        'A variant with these options already exists for this product',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------

  async updateVariant(id: string, dto: UpdateVariantDto) {
    const existing = await this.prisma.productVariant.findFirst({
      where: {
        id,
        isDeleted: false,
      },
      include: {
        product: {
          select: this.productSelect,
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('Product variant not found');
    }

    const data: Prisma.ProductVariantUpdateInput = {};

    if (dto.options !== undefined) {
      const normalizedOptions = this.normalizeOptions(dto.options);

      data.options = normalizedOptions as unknown as Prisma.InputJsonValue;
      data.optionsKey = this.buildOptionsKey(normalizedOptions);
    }

    if (dto.stock !== undefined) {
      data.stock = dto.stock;
    }

    if (dto.images !== undefined) {
      data.images = dto.images;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields were provided for update');
    }

    try {
      const updated = await this.prisma.productVariant.update({
        where: {
          id,
        },
        data,
      });

      await this.invalidateVariantCaches(id, existing.productId);

      return this.toVariantResponse(
        {
          ...updated,
          product: existing.product,
        },
        existing.product.lowStockThreshold,
      );
    } catch (error) {
      this.handlePrismaError(
        error,
        'A variant with these options already exists for this product',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // STOCK
  // ---------------------------------------------------------------------------

  /**
   * Atomically changes stock and writes the corresponding history record.
   *
   * Negative quantity:
   *   removes stock.
   *
   * Positive quantity:
   *   adds stock.
   *
   * The conditional update prevents stock from ever becoming negative,
   * even when multiple requests attempt to decrement simultaneously.
   */
  async updateStock(
    id: string,
    quantityOrDto: number | UpdateVariantStockDto,
    descriptionOrCreatedBy?: string,
    createdBy?: string,
  ) {
    const dto: UpdateVariantStockDto =
      typeof quantityOrDto === 'number'
        ? { quantity: quantityOrDto, description: descriptionOrCreatedBy ?? '' }
        : quantityOrDto;
    const author =
      typeof quantityOrDto === 'number' ? createdBy : descriptionOrCreatedBy;

    if (dto.quantity === 0) {
      throw new BadRequestException('Stock adjustment cannot be zero');
    }

    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id,
        isDeleted: false,
      },
      select: {
        id: true,
        productId: true,
        isActive: true,
        stock: true,
        product: {
          select: {
            lowStockThreshold: true,
            isDeleted: true,
          },
        },
      },
    });

    if (!variant || variant.product.isDeleted) {
      throw new NotFoundException('Product variant not found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      /**
       * Atomic stock update.
       *
       * For a negative adjustment of -5:
       *
       * stock >= 5
       *
       * must be true at the time PostgreSQL performs
       * the UPDATE.
       */
      const result = await tx.productVariant.updateMany({
        where: {
          id,
          isDeleted: false,
          ...(dto.quantity < 0
            ? {
                stock: {
                  gte: Math.abs(dto.quantity),
                },
              }
            : {}),
        },
        data: {
          stock: {
            increment: dto.quantity,
          },
        },
      });

      if (result.count !== 1) {
        if (dto.quantity < 0) {
          throw new BadRequestException(
            'Insufficient stock for this adjustment',
          );
        }

        throw new NotFoundException('Product variant not found');
      }

      const updatedVariant = await tx.productVariant.findUniqueOrThrow({
        where: {
          id,
        },
        select: {
          id: true,
          productId: true,
          stock: true,
          isActive: true,
          updatedAt: true,
        },
      });

      /**
       * Because:
       *
       * newStock = oldStock + adjustment
       *
       * oldStock = newStock - adjustment
       *
       * we can derive the exact previous quantity
       * from the committed update.
       */
      const oldStockQuantity = updatedVariant.stock - dto.quantity;

      await tx.stockHistory.create({
        data: {
          adjustment: dto.quantity,
          oldStockQuantity,
          newStockQuantity: updatedVariant.stock,
          description: dto.description?.trim() || 'Manual stock adjustment',
          productId: updatedVariant.productId,
          variantId: updatedVariant.id,
          createdBy: author,
        },
      });

      return updatedVariant;
    });

    await this.invalidateVariantCaches(updated.id, updated.productId);

    return {
      id: updated.id,
      stock: updated.stock,
      inStock: updated.stock > 0,
      stockStatus: this.getStockStatus(
        updated.stock,
        variant.product.lowStockThreshold,
      ),
      updatedAt: updated.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // SOFT DELETE
  // ---------------------------------------------------------------------------

  async softDeleteVariant(id: string) {
    const existing = await this.prisma.productVariant.findFirst({
      where: {
        id,
        isDeleted: false,
      },
      select: {
        id: true,
        productId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('Product variant not found');
    }

    await this.prisma.productVariant.update({
      where: {
        id,
      },
      data: {
        isDeleted: true,
        isActive: false,
        deletedAt: new Date(),
      },
    });

    await this.invalidateVariantCaches(id, existing.productId);

    return {
      message: 'Product variant deleted successfully',
    };
  }

  // ---------------------------------------------------------------------------
  // REACTIVATE
  // ---------------------------------------------------------------------------

  async reactivateVariant(id: string) {
    try {
      const variant = await this.prisma.productVariant.update({
        where: {
          id,
        },
        data: {
          isDeleted: false,
          isActive: true,
          deletedAt: null,
        },
      });

      await this.invalidateVariantCaches(id, variant.productId);

      return this.toVariantResponse(variant);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Product variant not found');
      }

      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // ADMIN & VENDOR COMPATIBILITY METHODS
  // ---------------------------------------------------------------------------

  async create(productId: string, dto: CreateVariantDto) {
    return this.createVariant(productId, dto);
  }

  async update(id: string, dto: UpdateVariantDto) {
    return this.updateVariant(id, dto);
  }

  async deactivate(id: string) {
    const existing = await this.prisma.productVariant.findFirst({
      where: { id, isDeleted: false },
      select: { id: true, productId: true },
    });

    if (!existing) {
      throw new NotFoundException('Product variant not found');
    }

    const updated = await this.prisma.productVariant.update({
      where: { id },
      data: {
        isActive: false,
      },
      include: {
        product: {
          select: this.productSelect,
        },
      },
    });

    await this.invalidateVariantCaches(id, existing.productId);

    return this.toVariantResponse(updated, updated.product.lowStockThreshold);
  }

  async reactivate(id: string) {
    return this.reactivateVariant(id);
  }

  async permanentRemove(id: string): Promise<void> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
      select: { id: true, productId: true },
    });

    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }

    await this.prisma.productVariant.delete({
      where: { id },
    });

    await this.invalidateVariantCaches(id, variant.productId);
  }

  async createForVendor(
    vendorId: string,
    productId: string,
    dto: CreateVariantDto,
  ) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        vendorId,
        isDeleted: false,
      },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException(
        'Product not found or you do not own this product',
      );
    }

    return this.createVariant(productId, dto);
  }

  async updateForVendor(vendorId: string, id: string, dto: UpdateVariantDto) {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id,
        isDeleted: false,
        product: {
          vendorId,
        },
      },
      select: { id: true },
    });

    if (!variant) {
      throw new NotFoundException(
        'Product variant not found or you do not have access',
      );
    }

    return this.updateVariant(id, dto);
  }

  async deactivateForVendor(vendorId: string, id: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id,
        isDeleted: false,
        product: {
          vendorId,
        },
      },
      select: { id: true, productId: true },
    });

    if (!variant) {
      throw new NotFoundException(
        'Product variant not found or you do not have access',
      );
    }

    const updated = await this.prisma.productVariant.update({
      where: { id },
      data: {
        isActive: false,
      },
      include: {
        product: {
          select: this.productSelect,
        },
      },
    });

    await this.invalidateVariantCaches(id, variant.productId);

    return this.toVariantResponse(updated, updated.product.lowStockThreshold);
  }

  async reactivateForVendor(vendorId: string, id: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id,
        product: {
          vendorId,
        },
      },
      select: { id: true, productId: true },
    });

    if (!variant) {
      throw new NotFoundException(
        'Product variant not found or you do not have access',
      );
    }

    const updated = await this.prisma.productVariant.update({
      where: { id },
      data: {
        isDeleted: false,
        isActive: true,
        deletedAt: null,
      },
      include: {
        product: {
          select: this.productSelect,
        },
      },
    });

    await this.invalidateVariantCaches(id, variant.productId);

    return this.toVariantResponse(updated, updated.product.lowStockThreshold);
  }

  async permanentRemoveForVendor(vendorId: string, id: string): Promise<void> {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id,
        product: {
          vendorId,
        },
      },
      select: { id: true, productId: true },
    });

    if (!variant) {
      throw new NotFoundException(
        'Product variant not found or you do not have access',
      );
    }

    await this.prisma.productVariant.delete({
      where: { id },
    });

    await this.invalidateVariantCaches(id, variant.productId);
  }

  async updateStockForVendor(
    vendorId: string,
    id: string,
    quantity: number,
    description?: string,
  ) {
    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id,
        isDeleted: false,
        product: {
          vendorId,
        },
      },
      select: { id: true },
    });

    if (!variant) {
      throw new NotFoundException(
        'Product variant not found or you do not have access',
      );
    }

    return this.updateStock(
      id,
      { quantity, description: description ?? '' },
      vendorId,
    );
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Normalizes option names and values so logically identical
   * variants always generate the same optionsKey.
   */
  private normalizeOptions(
    options: VariantOptionItemDto[],
  ): VariantOptionItemDto[] {
    if (!Array.isArray(options) || options.length === 0) {
      throw new BadRequestException('At least one variant option is required');
    }

    const normalized = options.map((option) => ({
      name: option.name.trim().toLowerCase(),
      value: option.value.trim().toLowerCase(),
    }));

    const names = new Set<string>();

    for (const option of normalized) {
      if (!option.name || !option.value) {
        throw new BadRequestException(
          'Variant option names and values cannot be empty',
        );
      }

      if (names.has(option.name)) {
        throw new BadRequestException(
          `Duplicate variant option name: ${option.name}`,
        );
      }

      names.add(option.name);
    }

    normalized.sort((a, b) => a.name.localeCompare(b.name));

    return normalized;
  }

  /**
   * Generates the deterministic unique key used by PostgreSQL.
   */
  private buildOptionsKey(options: VariantOptionItemDto[]): string {
    return options.map((option) => `${option.name}:${option.value}`).join('|');
  }

  private getStockStatus(stock: number, lowStockThreshold: number): string {
    if (stock <= 0) {
      return 'Out of stock';
    }

    if (stock <= lowStockThreshold) {
      return 'Few items left';
    }

    return 'In stock';
  }

  private toProductReference(product: {
    id: string;
    name: string;
    slug: string;
    images: Array<{ url: string }>;
  }) {
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      imageUrl: product.images[0]?.url ?? null,
    };
  }

  private toVariantSummary(
    variant: {
      id: string;
      options: Prisma.JsonValue;
      stock: number;
      images: string[];
      isActive: boolean;
      isDeleted: boolean;
      deletedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    lowStockThreshold: number,
  ) {
    return {
      id: variant.id,
      options: this.parseOptions(variant.options),
      stock: variant.stock,
      inStock: variant.stock > 0,
      stockStatus: this.getStockStatus(variant.stock, lowStockThreshold),
      images: variant.images,
      isActive: variant.isActive,
      isDeleted: variant.isDeleted,
      deletedAt: variant.deletedAt,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    };
  }

  private toVariantResponse(
    variant: {
      id: string;
      options: Prisma.JsonValue;
      stock: number;
      images: string[];
      isActive: boolean;
      isDeleted: boolean;
      deletedAt?: Date | null;
      createdAt: Date;
      updatedAt: Date;
      product?: {
        id: string;
        name: string;
        slug: string;
        lowStockThreshold: number;
        images: Array<{ url: string }>;
      };
    },
    lowStockThreshold?: number,
  ) {
    const threshold =
      lowStockThreshold ?? variant.product?.lowStockThreshold ?? 5;

    return {
      id: variant.id,
      options: this.parseOptions(variant.options),
      stock: variant.stock,
      inStock: variant.stock > 0,
      stockStatus: this.getStockStatus(variant.stock, threshold),
      images: variant.images,
      product: variant.product
        ? this.toProductReference(variant.product)
        : undefined,
      isActive: variant.isActive,
      isDeleted: variant.isDeleted,
      deletedAt: variant.deletedAt ?? null,
      createdAt: variant.createdAt,
      updatedAt: variant.updatedAt,
    };
  }

  private parseOptions(options: Prisma.JsonValue): VariantOptionItemDto[] {
    if (!Array.isArray(options)) {
      return [];
    }

    return options.filter(
      (
        option,
      ): option is {
        name: string;
        value: string;
      } =>
        typeof option === 'object' &&
        option !== null &&
        'name' in option &&
        'value' in option &&
        typeof option.name === 'string' &&
        typeof option.value === 'string',
    );
  }

  /**
   * Targeted invalidation.
   *
   * We deliberately do not delete every variant cache in Redis.
   */
  private async invalidateVariantCaches(
    variantId: string,
    productId: string,
  ): Promise<void> {
    await Promise.all([
      this.cacheService.del(
        this.cacheService.buildKey(CacheKeys.VARIANT_DETAILS, variantId),
      ),

      this.cacheService.del(
        this.cacheService.buildKey(CacheKeys.VARIANT_PRODUCT, productId),
      ),

      this.cacheService.invalidateProductCache(productId),
    ]);
  }

  /**
   * Converts Prisma errors into domain-level HTTP exceptions.
   */
  private handlePrismaError(error: unknown, duplicateMessage: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException(duplicateMessage);
      }

      if (error.code === 'P2025') {
        throw new NotFoundException('Product variant not found');
      }
    }

    throw error;
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';

import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/database/prisma.service';

import { type CategoryLookupMap } from '../utils/product-includes.util';

/**
 * Answers category questions for products: the cached id-to-category map used to build breadcrumbs
 * without a query per product, a category id from an id or a path, and the ids of a category and
 * everything under it.
 */
@Injectable()
export class ProductCategoryResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  private categoryLookupCache: {
    map: CategoryLookupMap;
    expiresAt: number;
  } | null = null;

  /**
   * Cached map of all active categories for O(1) in-memory ancestor resolution.
   * Eliminates recursive N+1 database queries when rendering product lists.
   */
  async getCategoryLookupMap(): Promise<CategoryLookupMap> {
    if (
      this.categoryLookupCache &&
      this.categoryLookupCache.expiresAt > Date.now()
    ) {
      return this.categoryLookupCache.map;
    }

    const cacheKey = 'categories:lookup:map:v2';
    const list = await this.cacheService.wrap(cacheKey, 300, async () => {
      return this.prisma.category.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
        },
      });
    });

    const map: CategoryLookupMap = new Map();
    if (Array.isArray(list)) {
      for (const cat of list) {
        map.set(cat.id, cat);
      }
    }

    this.categoryLookupCache = {
      map,
      expiresAt: Date.now() + 60_000,
    };

    return map;
  }

  /** Forget the cached map (called when categories or products change). */
  invalidateLookup(): void {
    this.categoryLookupCache = null;
  }

  async resolveCategoryId(categoryId: string | undefined): Promise<string> {
    if (!categoryId) {
      throw new BadRequestException(
        'categoryId is required for product creation',
      );
    }

    const category = await this.prisma.category.findFirst({
      where: {
        id: categoryId,
      },

      select: {
        id: true,
        status: true,
        isActive: true,

        _count: {
          select: {
            children: true,
          },
        },
      },
    });

    if (!category) {
      throw new BadRequestException('Category not found');
    }

    if (category.status === 'ARCHIVED') {
      throw new BadRequestException(
        'Selected category is archived and cannot be assigned to new products.',
      );
    }

    if (!category.isActive || category.status === 'INACTIVE') {
      throw new BadRequestException(
        'Cannot assign a product to an inactive category',
      );
    }

    if (category._count.children > 0) {
      throw new BadRequestException(
        'Products can only be assigned to a leaf category node',
      );
    }

    return category.id;
  }

  /**
   * Returns the selected category and all descendants.
   *
   * Useful when the storefront allows browsing from a parent category.
   *
   * Requires an index on categories.parentId for good performance.
   */
  async collectCategoryAndDescendantIds(categoryId: string): Promise<string[]> {
    if (!categoryId) return [];

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        categoryId,
      );
    let resolvedId = categoryId;
    if (!isUuid) {
      const found = await this.prisma.category.findFirst({
        where: {
          OR: [{ slug: categoryId }, { path: categoryId }],
        },
        select: { id: true },
      });
      if (!found) return [categoryId];
      resolvedId = found.id;
    }

    // High-performance O(1) in-memory resolution from cached category map
    try {
      const categoryMap = await this.getCategoryLookupMap();
      if (categoryMap.has(resolvedId)) {
        const descendants: string[] = [resolvedId];
        const queue: string[] = [resolvedId];
        while (queue.length > 0) {
          const currentId = queue.shift()!;
          for (const cat of categoryMap.values()) {
            if (cat.parentId === currentId && !descendants.includes(cat.id)) {
              descendants.push(cat.id);
              queue.push(cat.id);
            }
          }
        }
        return descendants;
      }
    } catch {
      // Fallback to recursive CTE below
    }

    try {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        WITH RECURSIVE category_descendants AS (
          SELECT id
          FROM "categories"
          WHERE id = ${resolvedId}

          UNION ALL

          SELECT category.id
          FROM "categories" category
          INNER JOIN category_descendants parent
            ON category."parentId" = parent.id
        )
        SELECT id
        FROM category_descendants
      `;
      if (rows && rows.length > 0) {
        return rows.map((r) => r.id);
      }
    } catch {
      // Fallback below
    }

    const current = await this.prisma.category.findUnique({
      where: { id: resolvedId },
      select: { id: true, path: true },
    });
    if (!current) {
      return [resolvedId];
    }

    const descendants = await this.prisma.category.findMany({
      where: {
        OR: [
          { id: resolvedId },
          { parentId: resolvedId },
          ...(current.path
            ? [{ path: { startsWith: `${current.path}/` } }]
            : []),
        ],
      },
      select: { id: true },
    });
    return descendants.map((d) => d.id);
  }
}

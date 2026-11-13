import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Category, CategoryStatus, Prisma } from '@prisma/client';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { AuditLogService } from '@api/common/audit-log/audit-log.service';
import {
  CATEGORY_BY_PATH,
  CATEGORY_BY_SLUG,
  CATEGORY_TREE,
  CATEGORY_TTL,
} from '@api/common/constants/cache.constant';
import { mapPrismaError } from '@api/common/utils/prisma-error.util';
import { generateSlug } from '@api/common/utils/slug.util';
import {
  CategoryBreadcrumbDto,
  CategoryResponseDto,
} from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { MoveCategoryDto } from './dto/move-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly auditLog: AuditLogService,
  ) {}

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // INTEGRITY & HIERARCHY VALIDATIONS
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Validates parent category eligibility.
   * - Cannot set self as parent.
   * - Parent must exist.
   * - Parent must not be ARCHIVED.
   */
  private async validateParent(
    parentId: string | null,
    currentCategoryId?: string,
  ): Promise<Category | null> {
    if (!parentId) return null;

    if (currentCategoryId && parentId === currentCategoryId) {
      throw new BadRequestException('A category cannot be its own parent.');
    }

    const parent = await this.prisma.category.findUnique({
      where: { id: parentId },
    });

    if (!parent) {
      throw new NotFoundException(
        `Parent category with ID '${parentId}' does not exist.`,
      );
    }

    if (parent.status === CategoryStatus.ARCHIVED) {
      throw new BadRequestException(
        `Cannot attach category to archived parent category '${parent.name}'. Restore the parent first.`,
      );
    }

    if (currentCategoryId) {
      // Prevent circular hierarchy: new parent cannot be a descendant of current category
      const descendantIds = await this.getDescendantIds(currentCategoryId);
      if (descendantIds.includes(parentId)) {
        throw new BadRequestException(
          'Circular hierarchy detected: cannot move a category under one of its own descendants.',
        );
      }
    }

    return parent;
  }

  /**
   * Validates that sibling categories do not share the exact same name (case-insensitive).
   */
  private async validateSiblingNameUniqueness(
    name: string,
    parentId: string | null,
    currentCategoryId?: string,
  ): Promise<void> {
    const trimmedName = name.trim();
    const existing = await this.prisma.category.findFirst({
      where: {
        parentId,
        name: { equals: trimmedName, mode: 'insensitive' },
        ...(currentCategoryId ? { id: { not: currentCategoryId } } : {}),
      },
    });

    if (existing) {
      throw new ConflictException(
        `A category named '${trimmedName}' already exists under the same parent.`,
      );
    }
  }

  /**
   * Resolves and validates a unique slug for the category.
   */
  private async resolveUniqueSlug(
    name: string,
    desiredSlug?: string,
    currentCategoryId?: string,
  ): Promise<string> {
    const baseSlug = desiredSlug?.trim()
      ? generateSlug(desiredSlug.trim())
      : generateSlug(name.trim());

    if (!baseSlug) {
      throw new BadRequestException('Invalid category name or slug.');
    }

    const conflict = await this.prisma.category.findFirst({
      where: {
        slug: baseSlug,
        ...(currentCategoryId ? { id: { not: currentCategoryId } } : {}),
      },
    });

    if (conflict) {
      throw new ConflictException(
        `A category with slug '${baseSlug}' already exists. Please choose a distinct name or slug.`,
      );
    }

    return baseSlug;
  }

  /**
   * Builds the materialized hierarchical path string (e.g. "electronics/phones/samsung").
   */
  private buildPathString(slug: string, parentPath?: string | null): string {
    return parentPath ? `${parentPath}/${slug}` : slug;
  }

  /**
   * Recursively recalculates and updates the materialized path of all descendants.
   */
  private async updateDescendantPathsInTx(
    tx: Prisma.TransactionClient,
    parentId: string,
    parentPath: string,
  ): Promise<void> {
    const children = await tx.category.findMany({
      where: { parentId },
      select: { id: true, slug: true },
    });

    for (const child of children) {
      const childPath = `${parentPath}/${child.slug}`;
      await tx.category.update({
        where: { id: child.id },
        data: { path: childPath },
      });
      await this.updateDescendantPathsInTx(tx, child.id, childPath);
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // MUTATIONS (ADMIN)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Creates a new category node (root or child).
   */
  async create(
    dto: CreateCategoryDto,
    adminId?: string,
  ): Promise<CategoryResponseDto> {
    const parentId = dto.parentId ?? null;
    const parent = await this.validateParent(parentId);
    await this.validateSiblingNameUniqueness(dto.name, parentId);

    const slug = await this.resolveUniqueSlug(dto.name, dto.slug);
    const path = this.buildPathString(slug, parent?.path ?? parent?.slug);

    const status =
      dto.status ??
      (dto.isActive === false
        ? CategoryStatus.INACTIVE
        : CategoryStatus.ACTIVE);
    const isActive = status === CategoryStatus.ACTIVE;

    try {
      const category = await this.prisma.category.create({
        data: {
          name: dto.name.trim(),
          slug,
          description: dto.description?.trim() || null,
          imageUrl: dto.imageUrl?.trim() || null,
          parentId,
          sortOrder: dto.sortOrder ?? 0,
          status,
          isActive,
          path,
        },
      });

      await this.auditLog.log({
        action: 'CATEGORY_CREATED',
        entity: 'Category',
        entityId: category.id,
        adminId,
        payload: {
          name: category.name,
          slug: category.slug,
          parentId: category.parentId,
          status: category.status,
          path: category.path,
        },
      });

      await this.invalidateCache();
      return this.toCategoryResponse(category);
    } catch (error) {
      mapPrismaError(error);
    }
  }

  /**
   * Updates an existing category node's metadata, status, or parent.
   */
  async update(
    id: string,
    dto: UpdateCategoryDto,
    adminId?: string,
  ): Promise<CategoryResponseDto> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Category with ID '${id}' not found.`);
    }

    const newName = dto.name !== undefined ? dto.name.trim() : existing.name;
    const newParentId =
      dto.parentId !== undefined ? dto.parentId : existing.parentId;

    const parentChanged = newParentId !== existing.parentId;
    const nameChanged = newName !== existing.name;

    if (parentChanged) {
      await this.validateParent(newParentId, id);
    }

    if (nameChanged || parentChanged) {
      await this.validateSiblingNameUniqueness(newName, newParentId, id);
    }

    let newSlug = existing.slug;
    if (dto.slug !== undefined && dto.slug.trim() !== existing.slug) {
      newSlug = await this.resolveUniqueSlug(newName, dto.slug, id);
    } else if (nameChanged && !dto.slug) {
      newSlug = await this.resolveUniqueSlug(newName, undefined, id);
    }

    let targetParentPath: string | null = null;
    if (newParentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: newParentId },
        select: { path: true, slug: true },
      });
      targetParentPath = parent?.path || parent?.slug || null;
    }

    const newPath = this.buildPathString(newSlug, targetParentPath);

    let newStatus = existing.status;
    if (dto.status !== undefined) {
      newStatus = dto.status;
    } else if (dto.isActive !== undefined) {
      newStatus = dto.isActive
        ? CategoryStatus.ACTIVE
        : CategoryStatus.INACTIVE;
    }
    const newIsActive = newStatus === CategoryStatus.ACTIVE;

    const updated = await this.prisma.$transaction(async (tx) => {
      const cat = await tx.category.update({
        where: { id },
        data: {
          name: newName,
          slug: newSlug,
          description:
            dto.description !== undefined
              ? dto.description?.trim() || null
              : existing.description,
          imageUrl:
            dto.imageUrl !== undefined
              ? dto.imageUrl?.trim() || null
              : existing.imageUrl,
          parentId: newParentId,
          sortOrder:
            dto.sortOrder !== undefined ? dto.sortOrder : existing.sortOrder,
          status: newStatus,
          isActive: newIsActive,
          path: newPath,
        },
      });

      if (existing.path !== newPath) {
        await this.updateDescendantPathsInTx(tx, cat.id, newPath);
      }

      return cat;
    });

    await this.auditLog.log({
      action: 'CATEGORY_UPDATED',
      entity: 'Category',
      entityId: updated.id,
      adminId,
      payload: {
        old: {
          name: existing.name,
          slug: existing.slug,
          parentId: existing.parentId,
          status: existing.status,
          path: existing.path,
        },
        new: {
          name: updated.name,
          slug: updated.slug,
          parentId: updated.parentId,
          status: updated.status,
          path: updated.path,
        },
      },
    });

    await this.invalidateCache();
    return this.toCategoryResponse(updated);
  }

  /**
   * Explicit move operation: Reparents a category and updates descendant paths.
   */
  async moveCategory(
    id: string,
    dto: MoveCategoryDto,
    adminId?: string,
  ): Promise<CategoryResponseDto> {
    return this.update(id, { parentId: dto.newParentId }, adminId);
  }

  /**
   * Reorders sibling categories sharing a given parent.
   */
  async reorderChildren(
    parentId: string | null,
    categoryIds: string[],
    adminId?: string,
  ): Promise<CategoryResponseDto[]> {
    if (!categoryIds || categoryIds.length === 0) {
      throw new BadRequestException('categoryIds array cannot be empty.');
    }

    const categories = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
    });

    const invalid = categories.filter((c) => c.parentId !== parentId);
    if (invalid.length > 0) {
      throw new BadRequestException(
        `All reordered categories must belong to parent '${parentId ?? 'root'}'.`,
      );
    }

    await this.prisma.$transaction(
      categoryIds.map((id, index) =>
        this.prisma.category.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );

    await this.auditLog.log({
      action: 'CATEGORIES_REORDERED',
      entity: 'Category',
      adminId,
      payload: { parentId, order: categoryIds },
    });

    await this.invalidateCache();
    return this.getChildren(parentId, true);
  }

  /**
   * Activates or deactivates a category node, cascading to all descendants.
   */
  async setActive(
    idOrSlug: string,
    isActive: boolean,
    adminId?: string,
  ): Promise<void> {
    const category = await this.resolveCategory(idOrSlug);
    const targetStatus = isActive
      ? CategoryStatus.ACTIVE
      : CategoryStatus.INACTIVE;

    const descendantIds = await this.getDescendantIds(category.id);
    const allAffectedIds = [category.id, ...descendantIds];

    await this.prisma.$transaction([
      this.prisma.category.updateMany({
        where: { id: { in: allAffectedIds } },
        data: {
          status: targetStatus,
          isActive,
        },
      }),
    ]);

    await this.auditLog.log({
      action: isActive ? 'CATEGORY_ACTIVATED' : 'CATEGORY_DEACTIVATED',
      entity: 'Category',
      entityId: category.id,
      adminId,
      payload: {
        categoryName: category.name,
        slug: category.slug,
        cascadedToCount: descendantIds.length,
      },
    });

    await this.invalidateCache();
  }

  /**
   * Archives a category. Retains historical associations but prevents new product assignments.
   * Cascades ARCHIVED status to all descendants.
   */
  async archiveCategory(
    idOrSlug: string,
    adminId?: string,
  ): Promise<CategoryResponseDto> {
    const category = await this.resolveCategory(idOrSlug);
    const descendantIds = await this.getDescendantIds(category.id);
    const allAffectedIds = Array.from(new Set([category.id, ...descendantIds]));

    await this.prisma.$transaction([
      this.prisma.category.updateMany({
        where: { id: { in: allAffectedIds } },
        data: {
          status: CategoryStatus.ARCHIVED,
          isActive: false,
        },
      }),
    ]);

    await this.auditLog.log({
      action: 'CATEGORY_ARCHIVED',
      entity: 'Category',
      entityId: category.id,
      adminId,
      payload: {
        categoryName: category.name,
        slug: category.slug,
        cascadedToCount: descendantIds.length,
      },
    });

    await this.invalidateCache();
    const updated = await this.prisma.category.findUniqueOrThrow({
      where: { id: category.id },
    });
    return this.toCategoryResponse(updated);
  }

  /**
   * Restores an archived category to ACTIVE status.
   */
  async restoreCategory(
    idOrSlug: string,
    adminId?: string,
  ): Promise<CategoryResponseDto> {
    const category = await this.resolveCategory(idOrSlug);

    if (category.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: category.parentId },
      });
      if (parent && parent.status === CategoryStatus.ARCHIVED) {
        throw new BadRequestException(
          `Cannot restore category because its parent '${parent.name}' is archived. Restore the parent first.`,
        );
      }
    }

    const updated = await this.prisma.category.update({
      where: { id: category.id },
      data: {
        status: CategoryStatus.ACTIVE,
        isActive: true,
      },
    });

    await this.auditLog.log({
      action: 'CATEGORY_RESTORED',
      entity: 'Category',
      entityId: category.id,
      adminId,
      payload: {
        categoryName: category.name,
        slug: category.slug,
      },
    });

    await this.invalidateCache();
    return this.toCategoryResponse(updated);
  }

  /**
   * Safe permanent deletion. Only allowed for leaf categories with NO products attached.
   */
  async remove(
    idOrSlug: string,
    adminId?: string,
  ): Promise<{ message: string }> {
    const category = await this.resolveCategory(idOrSlug);

    const childCount = await this.prisma.category.count({
      where: { parentId: category.id },
    });

    if (childCount > 0) {
      throw new ConflictException(
        `Cannot delete category '${category.name}' because it contains ${childCount} child categories. Delete, archive, or reassign child categories first.`,
      );
    }

    const productCount = await this.prisma.product.count({
      where: { categoryId: category.id, isDeleted: false },
    });

    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete category '${category.name}' because ${productCount} active products are assigned to it. Reassign or archive the category instead.`,
      );
    }

    await this.prisma.category.delete({ where: { id: category.id } });

    await this.auditLog.log({
      action: 'CATEGORY_DELETED',
      entity: 'Category',
      entityId: category.id,
      adminId,
      payload: {
        deletedName: category.name,
        deletedSlug: category.slug,
      },
    });

    await this.invalidateCache();
    return { message: `Category '${category.name}' permanently deleted.` };
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // READ OPERATIONS & HIERARCHY TREE
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Returns root categories (parentId = null).
   */
  async getRootCategories(
    includeInactive = false,
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.prisma.category.findMany({
      where: {
        parentId: null,
        ...(includeInactive
          ? { status: { not: CategoryStatus.ARCHIVED } }
          : { status: CategoryStatus.ACTIVE, isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return categories.map((c) => this.toCategoryResponse(c));
  }

  /**
   * Returns direct children of a parent node.
   */
  async getChildren(
    parentId: string | null,
    includeInactive = false,
  ): Promise<CategoryResponseDto[]> {
    const categories = await this.prisma.category.findMany({
      where: {
        parentId,
        ...(includeInactive
          ? { status: { not: CategoryStatus.ARCHIVED } }
          : { status: CategoryStatus.ACTIVE, isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return categories.map((c) => this.toCategoryResponse(c));
  }

  /**
   * Builds the complete nested category hierarchy tree.
   * Optimized: Exactly 2 database queries, assembled in memory in O(N).
   */
  async getTree(
    includeInactive = false,
    includeArchived = false,
  ): Promise<CategoryResponseDto[]> {
    // Bump this suffix when the public tree shape changes so Redis cannot
    // keep serving the previous duplicated `subCategories` payload.
    const cacheKey = `${CATEGORY_TREE()}:v2:${includeInactive}:${includeArchived}`;
    return this.cacheService.wrap(cacheKey, CATEGORY_TTL, async () => {
      // 1. Fetch all matching categories
      const categories = await this.prisma.category.findMany({
        where: includeArchived
          ? undefined
          : includeInactive
            ? { status: { not: CategoryStatus.ARCHIVED } }
            : { status: CategoryStatus.ACTIVE, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      // Product counts are needed for admin management, but add a full products
      // table aggregation to every public route render if computed here.
      const includeProductCounts = includeInactive || includeArchived;
      const productCounts = includeProductCounts
        ? await this.prisma.product.groupBy({
            by: ['categoryId'],
            _count: { id: true },
            where: { isDeleted: false, isActive: true },
          })
        : [];

      const countMap = new Map<string, number>();
      for (const item of productCounts) {
        countMap.set(item.categoryId, item._count.id);
      }

      // 3. Assemble tree in-memory
      const nodeMap = new Map<string, CategoryResponseDto>();
      for (const cat of categories) {
        const node = this.toCategoryResponse(cat);
        if (includeProductCounts) {
          node.productCount = countMap.get(cat.id) ?? 0;
        }
        node.children = [];
        // Keep the legacy alias for admin consumers, but avoid serializing the
        // same recursive tree twice in public navigation and RSC payloads.
        if (includeInactive || includeArchived) {
          node.subCategories = node.children;
        }
        nodeMap.set(cat.id, node);
      }

      const roots: CategoryResponseDto[] = [];
      for (const cat of categories) {
        const node = nodeMap.get(cat.id)!;
        if (cat.parentId && nodeMap.has(cat.parentId)) {
          const parent = nodeMap.get(cat.parentId)!;
          parent.children!.push(node);
          parent.childrenCount = parent.children!.length;
        } else {
          roots.push(node);
        }
      }

      // Mark leaf status, compute depths, and roll up product counts hierarchically
      const computeMeta = (
        node: CategoryResponseDto,
        currentDepth: number,
      ): number => {
        node.depth = currentDepth;
        node.isRoot = currentDepth === 0;
        node.isLeaf = (node.children?.length ?? 0) === 0;
        node.childrenCount = node.children?.length ?? 0;
        let totalCount = node.productCount ?? 0;
        for (const child of node.children || []) {
          totalCount += computeMeta(child, currentDepth + 1);
        }
        if (includeProductCounts) {
          node.productCount = totalCount;
        }
        return totalCount;
      };

      for (const root of roots) {
        computeMeta(root, 0);
      }

      return roots;
    });
  }

  /**
   * Resolves a category by UUID or slug with full breadcrumbs and details.
   */
  async findOne(id: string): Promise<CategoryResponseDto> {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException(`Category with ID '${id}' not found.`);
    }

    const breadcrumbs = await this.getBreadcrumbs(category.id);
    const descendantIds = await this.getDescendantIds(category.id);
    const productCount = await this.prisma.product.count({
      where: {
        categoryId: { in: descendantIds },
        isDeleted: false,
        isActive: true,
      },
    });
    const childrenCount = await this.prisma.category.count({
      where: { parentId: category.id },
    });

    const response = this.toCategoryResponse(category);
    response.breadcrumbs = breadcrumbs;
    response.depth = breadcrumbs.length - 1;
    response.isRoot = category.parentId === null;
    response.isLeaf = childrenCount === 0;
    response.productCount = productCount;
    response.childrenCount = childrenCount;

    return response;
  }

  /**
   * Resolves a category by unique URL slug with breadcrumbs and children.
   */
  async findBySlug(
    slug: string,
    includeInactive = false,
  ): Promise<CategoryResponseDto> {
    const cacheKey = `${CATEGORY_BY_SLUG(slug)}:${includeInactive}`;
    const loadCategory = async () => {
      const category = await this.prisma.category.findUnique({
        where: { slug },
        include: {
          children: {
            where: includeInactive
              ? undefined
              : { status: CategoryStatus.ACTIVE, isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          },
        },
      });

      if (
        !category ||
        (!includeInactive && category.status !== CategoryStatus.ACTIVE)
      ) {
        throw new NotFoundException(`Category with slug '${slug}' not found.`);
      }

      const breadcrumbs = await this.getBreadcrumbs(category.id);
      const descendantIds = await this.getDescendantIds(category.id);
      const productCount = await this.prisma.product.count({
        where: {
          categoryId: { in: descendantIds },
          isDeleted: false,
          isActive: true,
        },
      });

      const response = this.toCategoryResponse(category);
      response.breadcrumbs = breadcrumbs;
      response.depth = breadcrumbs.length - 1;
      response.isRoot = category.parentId === null;
      response.isLeaf = (category.children?.length ?? 0) === 0;
      response.productCount = productCount;
      response.childrenCount = category.children?.length ?? 0;
      response.children = (category.children || []).map((c) =>
        this.toCategoryResponse(c),
      );
      response.subCategories = response.children;

      return response;
    };

    return this.cacheService.wrap(cacheKey, CATEGORY_TTL, loadCategory);
  }

  /**
   * Resolves a nested category path (e.g. ['fashion', 'womenswear', 'dresses']).
   */
  async findByPath(
    pathSlugs: string[],
    includeInactive = false,
  ): Promise<CategoryResponseDto> {
    if (!pathSlugs || pathSlugs.length === 0) {
      throw new BadRequestException('Path parameter cannot be empty.');
    }

    const pathString = pathSlugs.join('/');
    const cacheKey = `${CATEGORY_BY_PATH(pathString)}:${includeInactive}`;
    const loadCategory = async () => {
      // Fast path: Lookup by materialized path
      let category = await this.prisma.category.findFirst({
        where: {
          path: pathString,
          ...(includeInactive
            ? {}
            : { status: CategoryStatus.ACTIVE, isActive: true }),
        },
        include: {
          children: {
            where: includeInactive
              ? undefined
              : { status: CategoryStatus.ACTIVE, isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          },
        },
      });

      // Fallback: Resolve leaf slug and verify full ancestry
      if (!category) {
        const leafSlug = pathSlugs[pathSlugs.length - 1];
        const candidate = await this.prisma.category.findUnique({
          where: { slug: leafSlug },
          include: {
            children: {
              where: includeInactive
                ? undefined
                : { status: CategoryStatus.ACTIVE, isActive: true },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            },
          },
        });

        if (candidate) {
          const candidateCrumbs = await this.getBreadcrumbs(candidate.id);
          const candidateSlugs = candidateCrumbs.map((c) => c.slug);
          const candidateFull = candidateSlugs.join('/');
          if (
            candidateFull === pathString ||
            (pathSlugs.length === 1 && candidate.slug === leafSlug) ||
            candidateFull.endsWith('/' + pathString)
          ) {
            category = candidate;
          }
        }
      }

      if (!category) {
        throw new NotFoundException(`Category path '${pathString}' not found.`);
      }

      const breadcrumbs = await this.getBreadcrumbs(category.id);
      const descendantIds = await this.getDescendantIds(category.id);
      const productCount = await this.prisma.product.count({
        where: {
          categoryId: { in: descendantIds },
          isDeleted: false,
          isActive: true,
        },
      });

      const response = this.toCategoryResponse(category);
      response.breadcrumbs = breadcrumbs;
      response.depth = breadcrumbs.length - 1;
      response.isRoot = category.parentId === null;
      response.isLeaf = (category.children?.length ?? 0) === 0;
      response.productCount = productCount;
      response.childrenCount = category.children?.length ?? 0;
      response.children = (category.children || []).map((c) =>
        this.toCategoryResponse(c),
      );
      response.subCategories = response.children;

      return response;
    };

    return this.cacheService.wrap(cacheKey, CATEGORY_TTL, loadCategory);
  }

  /**
   * Search categories across the hierarchy, displaying full breadcrumb paths.
   */
  async searchCategories(
    query: string,
    includeInactive = false,
  ): Promise<CategoryResponseDto[]> {
    const trimmed = query?.trim();
    if (!trimmed) return [];

    const categories = await this.prisma.category.findMany({
      where: {
        OR: [
          { name: { contains: trimmed, mode: 'insensitive' } },
          { slug: { contains: trimmed, mode: 'insensitive' } },
          { path: { contains: trimmed, mode: 'insensitive' } },
        ],
        ...(includeInactive
          ? { status: { not: CategoryStatus.ARCHIVED } }
          : { status: CategoryStatus.ACTIVE, isActive: true }),
      },
      take: 25,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    // Populate breadcrumbs for search matches
    const results: CategoryResponseDto[] = [];
    for (const cat of categories) {
      const breadcrumbs = await this.getBreadcrumbs(cat.id);
      const res = this.toCategoryResponse(cat);
      res.breadcrumbs = breadcrumbs;
      res.depth = breadcrumbs.length - 1;
      res.isRoot = cat.parentId === null;
      results.push(res);
    }

    return results;
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // HIERARCHICAL RECURSIVE QUERIES (SINGLE POSTGRESQL CTEs)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Returns breadcrumbs from root down to this category using a single recursive CTE.
   */
  async getBreadcrumbs(categoryId: string): Promise<CategoryBreadcrumbDto[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        slug: string;
        path: string | null;
        depth: number;
      }>
    >`
      WITH RECURSIVE category_ancestors AS (
        SELECT id, name, slug, path, "parentId", 0 as depth
        FROM "categories"
        WHERE id = ${categoryId}

        UNION ALL

        SELECT parent.id, parent.name, parent.slug, parent.path, parent."parentId", ca.depth + 1
        FROM "categories" parent
        INNER JOIN category_ancestors ca ON parent.id = ca."parentId"
      )
      SELECT id, name, slug, path, depth
      FROM category_ancestors
      ORDER BY depth DESC;
    `;

    return rows.map((r, index) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      path: r.path || r.slug,
      depth: index,
    }));
  }

  /**
   * Returns all descendant category IDs (including the target category itself).
   */
  async getDescendantIds(categoryId: string): Promise<string[]> {
    const current = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, path: true },
    });
    if (!current) {
      return [categoryId];
    }
    if (!current.path) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
        WITH RECURSIVE category_descendants AS (
          SELECT id
          FROM "categories"
          WHERE id = ${categoryId}

          UNION ALL

          SELECT child.id
          FROM "categories" child
          INNER JOIN category_descendants parent ON child."parentId" = parent.id
        )
        SELECT id FROM category_descendants;
      `;
      return rows.map((r) => r.id);
    }

    const descendants = await this.prisma.category.findMany({
      where: {
        OR: [{ id: categoryId }, { path: { startsWith: `${current.path}/` } }],
      },
      select: { id: true },
    });
    return descendants.map((d) => d.id);
  }

  /**
   * Returns all direct ancestors of a category node.
   */
  async getAncestors(categoryId: string): Promise<CategoryBreadcrumbDto[]> {
    const crumbs = await this.getBreadcrumbs(categoryId);
    return crumbs.slice(0, -1);
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // HELPERS
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async resolveCategory(idOrSlug: string): Promise<Category> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idOrSlug,
      );

    const category = await this.prisma.category.findFirst({
      where: isUuid ? { id: idOrSlug } : { slug: idOrSlug },
    });

    if (!category) {
      throw new NotFoundException(`Category '${idOrSlug}' not found.`);
    }

    return category;
  }

  private async invalidateCache(): Promise<void> {
    try {
      await this.cacheService.delByPattern('category:*');
    } catch (err) {
      this.logger.warn({ err }, 'Cache invalidation warning');
    }
  }

  private toCategoryResponse(category: Category): CategoryResponseDto {
    const isRoot = category.parentId === null;
    const depth = category.path
      ? category.path.split('/').length - 1
      : isRoot
        ? 0
        : 1;

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      imageUrl: category.imageUrl,
      parentId: category.parentId,
      sortOrder: category.sortOrder,
      status: category.status,
      isActive: category.isActive && category.status === CategoryStatus.ACTIVE,
      path: category.path || category.slug,
      depth,
      isRoot,
      isLeaf: false, // Calculated by caller if children count is available
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
      level: isRoot ? 'CATEGORY' : 'SUBCATEGORY', // Backward compatibility for legacy clients
    };
  }
}

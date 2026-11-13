import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CategoryStatus } from '@prisma/client';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { AuditLogService } from '@api/common/audit-log/audit-log.service';
import { CategoriesService } from './categories.service';

describe('CategoriesService (Hierarchical Catalog System)', () => {
  let service: CategoriesService;
  type AsyncMock = jest.Mock<Promise<unknown>, unknown[]>;
  const asyncMock = (): AsyncMock => jest.fn<Promise<unknown>, unknown[]>();
  let prisma: {
    category: Record<string, AsyncMock>;
    product: Record<string, AsyncMock>;
    $queryRaw: AsyncMock;
    $transaction: jest.Mock<
      Promise<unknown>,
      [((transaction: PrismaService) => Promise<unknown>) | Promise<unknown>[]]
    >;
  };
  let cacheService: {
    get: AsyncMock;
    set: AsyncMock;
    delByPattern: AsyncMock;
  };
  let auditLog: { log: AsyncMock };

  const mockCategories: Record<string, unknown>[] = [
    {
      id: 'cat-root-electronics',
      name: 'Electronics',
      slug: 'electronics',
      description: 'Electronics root',
      imageUrl: null,
      parentId: null,
      sortOrder: 0,
      status: CategoryStatus.ACTIVE,
      isActive: true,
      path: 'electronics',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'cat-child-phones',
      name: 'Phones',
      slug: 'phones',
      description: 'Mobile phones',
      imageUrl: null,
      parentId: 'cat-root-electronics',
      sortOrder: 0,
      status: CategoryStatus.ACTIVE,
      isActive: true,
      path: 'electronics/phones',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'cat-leaf-samsung',
      name: 'Samsung',
      slug: 'samsung',
      description: 'Samsung phones',
      imageUrl: null,
      parentId: 'cat-child-phones',
      sortOrder: 0,
      status: CategoryStatus.ACTIVE,
      isActive: true,
      path: 'electronics/phones/samsung',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(async () => {
    prisma = {
      category: {
        findUnique: asyncMock(),
        findUniqueOrThrow: asyncMock(),
        findFirst: asyncMock(),
        findMany: asyncMock(),
        create: asyncMock(),
        update: asyncMock(),
        updateMany: asyncMock(),
        delete: asyncMock(),
        count: asyncMock(),
      },
      product: {
        count: asyncMock(),
        groupBy: asyncMock().mockResolvedValue([]),
      },
      $queryRaw: asyncMock(),
      $transaction: jest.fn<
        Promise<unknown>,
        [
          | ((transaction: PrismaService) => Promise<unknown>)
          | Promise<unknown>[],
        ]
      >((cbOrArray) => {
        if (typeof cbOrArray === 'function') {
          return cbOrArray(prisma as unknown as PrismaService);
        }
        return Promise.all(cbOrArray);
      }),
    };

    cacheService = {
      get: asyncMock().mockResolvedValue(null),
      set: asyncMock().mockResolvedValue(undefined),
      delByPattern: asyncMock().mockResolvedValue(undefined),
    };

    auditLog = {
      log: asyncMock().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CacheService, useValue: cacheService },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  describe('1. Category Creation & Hierarchy', () => {
    it('should successfully create a root category (parentId = null)', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      prisma.category.create.mockResolvedValue({
        id: 'new-root-id',
        name: 'Home & Kitchen',
        slug: 'home-and-kitchen',
        description: null,
        imageUrl: null,
        parentId: null,
        sortOrder: 0,
        status: CategoryStatus.ACTIVE,
        isActive: true,
        path: 'home-and-kitchen',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create({
        name: 'Home & Kitchen',
      });

      expect(result.id).toBe('new-root-id');
      expect(result.parentId).toBeNull();
      expect(result.path).toBe('home-and-kitchen');
      expect(prisma.category.create).toHaveBeenCalled();
      const createArguments = prisma.category.create.mock.calls[0]?.[0];
      expect(createArguments).toMatchObject({
        data: {
          name: 'Home & Kitchen',
          slug: 'home-and-kitchen',
          parentId: null,
          status: CategoryStatus.ACTIVE,
        },
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CATEGORY_CREATED' }),
      );
    });

    it('should successfully create a deeply nested child category', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategories[1]); // parent: Phones
      prisma.category.findFirst.mockResolvedValue(null); // uniqueness check
      prisma.category.create.mockResolvedValue({
        id: 'new-android-id',
        name: 'Android Phones',
        slug: 'android-phones',
        description: null,
        imageUrl: null,
        parentId: 'cat-child-phones',
        sortOrder: 0,
        status: CategoryStatus.ACTIVE,
        isActive: true,
        path: 'electronics/phones/android-phones',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create({
        name: 'Android Phones',
        parentId: 'cat-child-phones',
      });

      expect(result.parentId).toBe('cat-child-phones');
      expect(result.path).toBe('electronics/phones/android-phones');
    });

    it('should reject creating a category under a non-existent parent', async () => {
      prisma.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create({
          name: 'Invalid Parent Category',
          parentId: 'non-existent-uuid',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject creating a category under an ARCHIVED parent', async () => {
      prisma.category.findUnique.mockResolvedValue({
        id: 'archived-parent',
        name: 'Archived Category',
        status: CategoryStatus.ARCHIVED,
      });

      await expect(
        service.create({
          name: 'Child Under Archived',
          parentId: 'archived-parent',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject duplicate sibling category names', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategories[0]);
      prisma.category.findFirst.mockResolvedValue({
        id: 'existing-sibling',
        name: 'Phones',
      });

      await expect(
        service.create({
          name: 'Phones',
          parentId: 'cat-root-electronics',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('2. Circular Relationship & Move Validation', () => {
    it('should reject setting category as its own parent', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategories[0]);

      await expect(
        service.update('cat-root-electronics', {
          parentId: 'cat-root-electronics',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject moving a category under one of its own descendants', async () => {
      prisma.category.findUnique.mockResolvedValue(mockCategories[2]); // Samsung target
      prisma.category.findMany.mockResolvedValue([
        { id: 'cat-root-electronics' },
        { id: 'cat-child-phones' },
        { id: 'cat-leaf-samsung' },
      ]);
      // Mock CTE descendant IDs of Electronics returning Phones and Samsung
      prisma.$queryRaw.mockResolvedValue([
        { id: 'cat-root-electronics' },
        { id: 'cat-child-phones' },
        { id: 'cat-leaf-samsung' },
      ]);

      await expect(
        service.moveCategory('cat-root-electronics', {
          newParentId: 'cat-leaf-samsung',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('3. Lifecycle: Archive & Safe Deletion', () => {
    it('should archive a category and cascade status to all descendants', async () => {
      prisma.category.findFirst.mockResolvedValue(mockCategories[0]);
      prisma.category.findUnique.mockResolvedValue(mockCategories[0]);
      prisma.category.findMany.mockResolvedValue([
        { id: 'cat-child-phones' },
        { id: 'cat-leaf-samsung' },
      ]);
      prisma.$queryRaw.mockResolvedValue([
        { id: 'cat-child-phones' },
        { id: 'cat-leaf-samsung' },
      ]);
      prisma.category.findUniqueOrThrow.mockResolvedValue({
        ...mockCategories[0],
        status: CategoryStatus.ARCHIVED,
        isActive: false,
      });

      const res = await service.archiveCategory('electronics');

      expect(res.status).toBe(CategoryStatus.ARCHIVED);
      expect(prisma.category.updateMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: [
              'cat-root-electronics',
              'cat-child-phones',
              'cat-leaf-samsung',
            ],
          },
        },
        data: {
          status: CategoryStatus.ARCHIVED,
          isActive: false,
        },
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CATEGORY_ARCHIVED' }),
      );
    });

    it('should reject permanent deletion if category contains products', async () => {
      prisma.category.findFirst.mockResolvedValue(mockCategories[2]);
      prisma.category.count.mockResolvedValueOnce(0); // 0 children
      prisma.product.count.mockResolvedValueOnce(45); // 45 products assigned

      await expect(service.remove('cat-leaf-samsung')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should reject permanent deletion if category contains subcategories', async () => {
      prisma.category.findFirst.mockResolvedValue(mockCategories[0]);
      prisma.category.count.mockResolvedValueOnce(2); // 2 children

      await expect(service.remove('cat-root-electronics')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('4. Breadcrumbs & Descendants CTE', () => {
    it('should retrieve ordered breadcrumb hierarchy using recursive CTE', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'cat-root-electronics',
          name: 'Electronics',
          slug: 'electronics',
          path: 'electronics',
          depth: 2,
        },
        {
          id: 'cat-child-phones',
          name: 'Phones',
          slug: 'phones',
          path: 'electronics/phones',
          depth: 1,
        },
        {
          id: 'cat-leaf-samsung',
          name: 'Samsung',
          slug: 'samsung',
          path: 'electronics/phones/samsung',
          depth: 0,
        },
      ]);

      const crumbs = await service.getBreadcrumbs('cat-leaf-samsung');

      expect(crumbs).toHaveLength(3);
      expect(crumbs[0].name).toBe('Electronics');
      expect(crumbs[1].name).toBe('Phones');
      expect(crumbs[2].name).toBe('Samsung');
    });

    it('should reorder children deterministically', async () => {
      prisma.category.findMany.mockResolvedValue([
        { id: 'child-1', parentId: 'parent-1' },
        { id: 'child-2', parentId: 'parent-1' },
      ]);
      prisma.category.findMany
        .mockResolvedValueOnce([
          { id: 'child-1', parentId: 'parent-1' },
          { id: 'child-2', parentId: 'parent-1' },
        ])
        .mockResolvedValueOnce([]);

      await service.reorderChildren('parent-1', ['child-2', 'child-1']);

      expect(prisma.category.update).toHaveBeenCalledWith({
        where: { id: 'child-2' },
        data: { sortOrder: 0 },
      });
      expect(prisma.category.update).toHaveBeenCalledWith({
        where: { id: 'child-1' },
        data: { sortOrder: 1 },
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CATEGORIES_REORDERED' }),
      );
    });
  });
});

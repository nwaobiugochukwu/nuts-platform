import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { AuditLogService } from '@api/common/audit-log/audit-log.service';
import { SearchService } from '@api/common/search/search.service';
import { CategoriesService } from '../categories/categories.service';
import { ProductsService } from './products.service';

const mockCacheService = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn(),
  del: jest.fn(),
  delByPattern: jest.fn(),
  wrap: jest.fn(),
  invalidate: jest.fn(),
  invalidateByPattern: jest.fn(),
  invalidateMany: jest.fn(),
};

const mockAuditLogService = {
  log: jest.fn(),
};

const mockSearchService = {
  searchProducts: jest.fn(),
  searchProductsWithDetails: jest.fn(),
  searchMarketplace: jest.fn(),
};

const mockCategoriesService = {
  assertLeafSubcategory: jest.fn().mockResolvedValue(undefined),
};

const mockPrisma = {
  product: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  category: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
  stockHistory: {
    create: jest.fn(),
    createMany: jest.fn(),
  },
};

describe('ProductsService â€“ Products CRUD', () => {
  let service: ProductsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCacheService },
        { provide: SearchService, useValue: mockSearchService },
        { provide: AuditLogService, useValue: mockAuditLogService },
        { provide: CategoriesService, useValue: mockCategoriesService },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  const mockProduct = {
    id: 'prod-123',
    name: 'Premium Almonds',
    slug: 'premium-almonds',
    description: 'Crispy and fresh',
    price: 2500,
    stock: 100,
    sku: 'ALM-123',
    imageUrl: null,
    isActive: true,
    categoryId: 'cat-456',
    createdAt: new Date(),
    updatedAt: new Date(),
    isDeleted: false,
    deletedAt: null,
    hasVariants: false,
    variants: [],
    images: [],
    category: { id: 'cat-456', name: 'Nuts', slug: 'nuts' },
    vendor: {
      id: 'vendor-1',
      storeName: 'Best Nuts',
      storeSlug: 'best-nuts',
      storeLogoUrl: null,
    },
  };

  describe('findOne', () => {
    it('should return a product by ID if found', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(mockProduct);

      const result = await service.findOne('prod-123');

      expect(result.id).toBe('prod-123');
      expect(result.name).toBe('Premium Almonds');
    });

    it('should throw NotFoundException if product is not found', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(service.findOne('missing-prod')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('restore', () => {
    it('should restore a soft-deleted product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        ...mockProduct,
        isDeleted: true,
      });
      mockPrisma.product.findMany.mockResolvedValue([]);
      mockPrisma.product.update.mockResolvedValue(mockProduct);

      const result = await service.restore('prod-123');

      expect(result.isActive).toBe(true);
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prod-123' },
          data: expect.objectContaining({ isDeleted: false }),
        }),
      );
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from '@api/infrastructure/cache/cache.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { ProductVariantsService } from './product-variants.service';

const mockPrisma = {
  product: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  productVariant: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    updateMany: jest.fn(),
  },
  stockHistory: {
    create: jest.fn(),
  },
};

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn().mockResolvedValue(undefined),
  delByPattern: jest.fn().mockResolvedValue(undefined),
  buildKey: jest.fn(
    (prefix: string, ...parts: string[]) => `${prefix}:${parts.join(':')}`,
  ),
  invalidateProductCache: jest.fn().mockResolvedValue(undefined),
};

describe('ProductVariantsService', () => {
  let service: ProductVariantsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductVariantsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get<ProductVariantsService>(ProductVariantsService);
  });

  const mockProduct = {
    id: 'prod-456',
    name: 'Premium Cashews',
    slug: 'premium-cashews',
    description: 'Premium roasted cashews',
    price: 12000,
    stock: 150,
    sku: 'NUTS-001',
    hasVariants: true,
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    vendor: {
      id: 'vendor-123',
      storeName: 'Best Nuts',
    },
    category: {
      id: 'cat-789',
      name: 'Nuts',
      slug: 'nuts',
    },
    images: [{ url: 'https://example.com/image.jpg' }],
  };

  const mockVariant = {
    id: 'variant-123',
    productId: 'prod-456',
    options: [{ name: 'Size', value: 'Large' }],
    stock: 10,
    images: [],
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    product: mockProduct,
  };

  describe('create', () => {
    it('should create and return a product variant', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(mockProduct);
      mockPrisma.productVariant.findMany.mockResolvedValue([]);
      mockPrisma.productVariant.create.mockResolvedValue(mockVariant);

      const result = await service.create('prod-456', {
        options: [{ name: 'Size', value: 'Large' }],
        stock: 10,
        images: [],
      });

      expect(result.id).toBe('variant-123');
      expect(mockPrisma.productVariant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ productId: 'prod-456' }) as unknown,
        }),
      );
    });

    it('should throw NotFoundException if product does not exist', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.create('missing-prod', {
          options: [],
          stock: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return all variants for a product', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(mockProduct);
      mockPrisma.productVariant.findMany.mockResolvedValue([mockVariant]);

      const result = await service.findAll('prod-456');

      expect(result.variants).toHaveLength(1);
      expect(result.variants[0].id).toBe('variant-123');
    });

    it('should throw NotFoundException for missing product', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(service.findAll('missing-prod')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createForVendor', () => {
    it('should create a variant when the vendor owns the product', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(mockProduct);
      mockPrisma.productVariant.findMany.mockResolvedValue([]);
      mockPrisma.productVariant.create.mockResolvedValue(mockVariant);

      const result = await service.createForVendor('vendor-123', 'prod-456', {
        options: [{ name: 'Size', value: 'Large' }],
        stock: 10,
      });

      expect(result.id).toBe('variant-123');
    });

    it('should throw NotFoundException when vendor does not own product', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.createForVendor('vendor-123', 'prod-456', {
          options: [{ name: 'Size', value: 'Large' }],
          stock: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return the variant', async () => {
      mockPrisma.productVariant.findFirst.mockResolvedValue(mockVariant);
      mockPrisma.productVariant.findMany.mockResolvedValue([]);
      mockPrisma.productVariant.update.mockResolvedValue({
        ...mockVariant,
        stock: 20,
      });

      const result = await service.update('variant-123', { stock: 20 });

      expect(result.stock).toBe(20);
      expect(mockPrisma.productVariant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'variant-123' },
          data: expect.objectContaining({ stock: 20 }) as unknown,
        }),
      );
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WishlistService } from './wishlist.service';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { CacheService } from '@api/infrastructure/cache/cache.service';

describe('WishlistService', () => {
  let service: WishlistService;
  let mockPrisma: any;
  let mockCacheService: any;

  const mockProduct = {
    id: 'prod-1',
    name: 'Wireless Headphones',
    slug: 'wireless-headphones',
    price: new Prisma.Decimal(150),
    hasVariants: false,
    images: [{ url: 'https://example.com/headphones.jpg' }],
  };

  const mockWishlistItem = {
    id: 'w-item-1',
    userId: 'user-1',
    productId: 'prod-1',
    variantId: null,
    createdAt: new Date(),
    product: mockProduct,
    variant: null,
  };

  beforeEach(() => {
    mockPrisma = {
      product: {
        findFirst: jest.fn(),
      },
      wishlistItem: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    mockCacheService = {
      wrap: jest.fn((key: string, ttl: number, fn: () => Promise<unknown>) =>
        fn(),
      ),
      del: jest.fn().mockResolvedValue(undefined),
    };

    service = new WishlistService(mockPrisma, mockCacheService);
  });

  describe('add()', () => {
    // -------------------------------------------------------------------------
    // UNIT / INTEGRATION: Valid product addition
    // -------------------------------------------------------------------------
    it('successfully adds an active product to the user wishlist and invalidates cache', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'prod-1',
        hasVariants: false,
      });
      mockPrisma.wishlistItem.findFirst.mockResolvedValue(null);
      mockPrisma.wishlistItem.create.mockResolvedValue(mockWishlistItem);

      const result = await service.add('user-1', 'prod-1');

      expect(result.productId).toBe('prod-1');
      expect(result.productName).toBe('Wireless Headphones');
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'user:wishlist:v3:user-1',
      );
    });

    // -------------------------------------------------------------------------
    // ERROR HANDLING: Non-existent or inactive product
    // -------------------------------------------------------------------------
    it('throws NotFoundException if product does not exist or is inactive/deleted', async () => {
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(service.add('user-1', 'invalid-prod')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.wishlistItem.create).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // ERROR HANDLING: Variant requested but not found or inactive
    // -------------------------------------------------------------------------
    it('throws NotFoundException if product has variants but requested variant does not exist', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'prod-1',
        hasVariants: true,
        variants: [], // Empty matching variants
      });

      await expect(
        service.add('user-1', 'prod-1', 'non-existent-var'),
      ).rejects.toThrow(NotFoundException);
    });

    // -------------------------------------------------------------------------
    // IDEMPOTENCY / CONCURRENCY: Item already in wishlist
    // -------------------------------------------------------------------------
    it('returns existing item idempotently without creating duplicate row', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'prod-1',
        hasVariants: false,
      });
      mockPrisma.wishlistItem.findFirst.mockResolvedValue(mockWishlistItem);

      const result = await service.add('user-1', 'prod-1');

      expect(result.id).toBe('w-item-1');
      expect(mockPrisma.wishlistItem.create).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // CONCURRENCY RACE (P2002 Unique Constraint Fallback)
    // -------------------------------------------------------------------------
    it('handles concurrent P2002 race gracefully by fetching and returning the winning record', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'prod-1',
        hasVariants: false,
      });
      mockPrisma.wishlistItem.findFirst
        .mockResolvedValueOnce(null) // first check returns null
        .mockResolvedValueOnce(mockWishlistItem); // fallback check returns created item

      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on (userId, productId)',
        { code: 'P2002', clientVersion: '7.8.0' },
      );
      mockPrisma.wishlistItem.create.mockRejectedValue(p2002Error);

      const result = await service.add('user-1', 'prod-1');

      expect(result.id).toBe('w-item-1');
    });
  });

  describe('findMine()', () => {
    // -------------------------------------------------------------------------
    // PERFORMANCE / CACHING: Cached wishlist retrieval
    // -------------------------------------------------------------------------
    it('retrieves user wishlist items through the cache layer', async () => {
      mockPrisma.wishlistItem.findMany.mockResolvedValue([mockWishlistItem]);

      const result = await service.findMine('user-1');

      expect(mockCacheService.wrap).toHaveBeenCalledWith(
        'user:wishlist:v3:user-1',
        120,
        expect.any(Function),
      );
      expect(result).toHaveLength(1);
      expect(result[0].productId).toBe('prod-1');
      expect(result[0].productPrice).toBe(150);
    });
  });

  describe('remove()', () => {
    // -------------------------------------------------------------------------
    // BUSINESS LOGIC: Remove wishlist item and invalidate cache
    // -------------------------------------------------------------------------
    it('deletes item by product ID and clears the cache', async () => {
      mockPrisma.wishlistItem.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove('user-1', 'prod-1');

      expect(mockPrisma.wishlistItem.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          productId: 'prod-1',
        },
      });
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'user:wishlist:v3:user-1',
      );
    });

    it('does not invalidate cache if no rows were deleted', async () => {
      mockPrisma.wishlistItem.deleteMany.mockResolvedValue({ count: 0 });

      await service.remove('user-1', 'non-existent-prod');

      expect(mockCacheService.del).not.toHaveBeenCalled();
    });
  });
});

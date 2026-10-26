import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InsufficientStockException } from '@api/modules/shared/errors/insufficient-stock.exception';
import { CacheService } from '@api/modules/infrastructure/cache/cache.service';
import { PrismaService } from '@api/modules/infrastructure/prisma/prisma.service';
import { DiscountCodeService } from '@api/modules/promotions/discount-code.service';
import { UsersService } from '@api/modules/users/users.service';
import { CartService } from './cart.service';

describe('CartService', () => {
  let service: CartService;
  let mockPrisma: any;
  let mockUsersService: any;
  let mockDiscountService: any;
  let mockCacheService: any;

  beforeEach(() => {
    mockPrisma = {
      cart: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      cartItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      product: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      productVariant: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
        callback(mockPrisma),
      ),
    };

    mockUsersService = {
      assertActiveAccount: jest.fn().mockResolvedValue(undefined),
    };

    mockDiscountService = {
      validate: jest.fn(),
      calculateDiscount: jest.fn(),
    };

    mockCacheService = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
      del: jest.fn().mockResolvedValue(undefined),
      wrap: jest.fn((key: string, ttl: number, fn: () => Promise<unknown>) =>
        fn(),
      ),
      invalidate: jest.fn().mockResolvedValue(undefined),
    };

    service = new CartService(
      mockPrisma,
      mockUsersService,
      mockDiscountService,
      mockCacheService,
    );
  });

  describe('addToCart', () => {
    it('rejects invalid or non-positive quantities', async () => {
      await expect(service.addToCart('u-1', 'p-1', 0)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.addToCart('u-1', 'p-1', -5)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.addToCart('u-1', 'p-1', 1.5)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when product does not exist or is inactive/deleted', async () => {
      /**
       * The service fetches the product via `tx.product.findFirst({ where: { id, isActive: true, isDeleted: false } })`.
       * When no active product matches (null return), it throws NotFoundException — NOT BadRequestException.
       * Tests must align to the real contract, not an assumed one.
       */
      mockPrisma.product.findFirst.mockResolvedValue(null);

      await expect(service.addToCart('u-1', 'p-inactive', 1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects addition when requested quantity exceeds available product stock', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'p-1',
        name: 'Shoes',
        isActive: true,
        isDeleted: false,
        stock: 3,
        hasVariants: false,
        price: new Prisma.Decimal(100),
      });

      mockPrisma.cart.findFirst.mockResolvedValue({
        id: 'c-1',
        userId: 'u-1',
        checkedOut: false,
        cartItems: [],
      });

      // No existing item, so newQuantity = 0 + 5 = 5 which exceeds stock(3)
      mockPrisma.cartItem.findFirst.mockResolvedValue(null);

      await expect(service.addToCart('u-1', 'p-1', 5)).rejects.toThrow(
        InsufficientStockException,
      );
    });

    it('successfully adds item and invalidates user cart cache via del()', async () => {
      const activeProduct = {
        id: 'p-1',
        name: 'Shoes',
        isActive: true,
        isDeleted: false,
        stock: 10,
        hasVariants: false,
        price: new Prisma.Decimal(100),
        images: [{ url: 'https://example.com/img.jpg', isPrimary: true }],
        category: null,
        vendor: null,
      };

      mockPrisma.product.findFirst.mockResolvedValue(activeProduct);

      const cartRecord = {
        id: 'c-1',
        userId: 'u-1',
        checkedOut: false,
        cartItems: [
          {
            id: 'ci-1',
            cartId: 'c-1',
            productId: 'p-1',
            variantId: null,
            quantity: 2,
            unitPrice: new Prisma.Decimal(100),
            totalPrice: new Prisma.Decimal(200),
            product: activeProduct,
            variant: null,
          },
        ],
      };

      // cart.findFirst is used by getOrCreateActiveCart (inside transaction + after mutation)
      mockPrisma.cart.findFirst.mockResolvedValue(cartRecord);
      // No existing cart item for this product
      mockPrisma.cartItem.findFirst.mockResolvedValue(null);
      mockPrisma.cartItem.create.mockResolvedValue(cartRecord.cartItems[0]);

      const response = await service.addToCart('u-1', 'p-1', 2);

      expect(response).toBeDefined();
      // invalidateCartCache() calls cacheService.del(), not .invalidate()
      expect(mockCacheService.del).toHaveBeenCalledWith(
        expect.stringContaining('user:cart:v3:u-1'),
      );
    });
  });

  describe('previewDiscount', () => {
    it('rejects discount preview on empty cart', async () => {
      mockPrisma.cart.findFirst.mockResolvedValue({
        id: 'c-empty',
        userId: 'u-1',
        checkedOut: false,
        cartItems: [],
      });

      await expect(service.previewDiscount('u-1', 'SAVE10')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects vendor-scoped discount if cart does not contain matching products', async () => {
      mockPrisma.cart.findFirst.mockResolvedValue({
        id: 'c-1',
        userId: 'u-1',
        checkedOut: false,
        cartItems: [
          {
            id: 'ci-1',
            productId: 'p-100',
            quantity: 1,
            unitPrice: new Prisma.Decimal(1000),
            totalPrice: new Prisma.Decimal(1000),
            product: {
              id: 'p-100',
              price: new Prisma.Decimal(1000),
              images: [],
              category: null,
              vendor: null,
            },
            variant: null,
          },
        ],
      });

      mockDiscountService.validate.mockResolvedValue({
        code: 'VENDOR_DEAL',
        scope: 'VENDOR',
        platformwide: false,
        applicableProductIds: ['p-200', 'p-300'], // Cart has p-100, not in the list
      });

      await expect(
        service.previewDiscount('u-1', 'VENDOR_DEAL'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('clearCart', () => {
    it('deletes cart items and invalidates cart cache via del()', async () => {
      const cartRecord = {
        id: 'c-1',
        userId: 'u-1',
        checkedOut: false,
        cartItems: [],
      };

      // clearCart calls cartItem.deleteMany, then invalidateCartCache, then getOrCreateActiveCart (findFirst)
      mockPrisma.cart.findFirst.mockResolvedValue(cartRecord);
      mockPrisma.cartItem.deleteMany.mockResolvedValue({ count: 0 });

      await service.clearCart('u-1');

      expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: {
          cart: {
            userId: 'u-1',
            checkedOut: false,
          },
        },
      });
      // invalidateCartCache() calls cacheService.del(), not .invalidate()
      expect(mockCacheService.del).toHaveBeenCalledWith(
        expect.stringContaining('user:cart:v3:u-1'),
      );
    });
  });
});

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DiscountCodeType, Prisma } from '@prisma/client';
import { PrismaService } from '@api/infrastructure/prisma/prisma.service';
import { DiscountCodeService } from './discount-code.service';

describe('DiscountCodeService', () => {
  let service: DiscountCodeService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      discountCode: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      discountCodeUsage: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      discountCodeUserUsage: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };

    service = new DiscountCodeService(mockPrisma);
  });

  describe('Validation & Calculation rules', () => {
    it('calculates PERCENTAGE discount with max cap', () => {
      const discount = {
        type: DiscountCodeType.PERCENTAGE,
        value: new Prisma.Decimal(20), // 20%
        maxDiscountAmount: new Prisma.Decimal(1000), // Max cap: 1000
      };

      // 20% of 10,000 = 2,000; capped at 1,000
      const calculated = service.calculateDiscount(
        discount,
        new Prisma.Decimal(10000),
      );
      expect(calculated.toString()).toBe('1000');
    });

    it('calculates FIXED discount and does not exceed order total', () => {
      const discount = {
        type: DiscountCodeType.FIXED,
        value: new Prisma.Decimal(500),
        maxDiscountAmount: null,
      };

      // Order total 300 < discount 500 => discount is 300
      const calculated = service.calculateDiscount(
        discount,
        new Prisma.Decimal(300),
      );
      expect(calculated.toString()).toBe('300');
    });

    it('rejects creation when perUserUsageLimit > usageLimit', async () => {
      await expect(
        service.create({
          code: 'INVALID',
          type: DiscountCodeType.PERCENTAGE,
          value: 10,
          usageLimit: 5,
          perUserUsageLimit: 10,
          platformwide: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects percentage discount greater than 100%', async () => {
      await expect(
        service.create({
          code: 'OVER100',
          type: DiscountCodeType.PERCENTAGE,
          value: 150,
          platformwide: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('validate()', () => {
    it('throws NotFoundException for non-existent or inactive codes', async () => {
      mockPrisma.discountCode.findFirst.mockResolvedValue(null);

      await expect(
        service.validate('INVALID', 'user-1', new Prisma.Decimal(1000)),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if code is not active yet (startsAt in future)', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockPrisma.discountCode.findFirst.mockResolvedValue({
        id: 'dc-1',
        code: 'FUTURE',
        isActive: true,
        deletedAt: null,
        startsAt: futureDate,
        expiresAt: null,
        minOrderAmount: new Prisma.Decimal(0),
        usageLimit: null,
        perUserUsageLimit: null,
      });

      await expect(
        service.validate('FUTURE', 'user-1', new Prisma.Decimal(1000)),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if code has expired (expiresAt in past)', async () => {
      const pastDate = new Date(Date.now() - 86400000);
      mockPrisma.discountCode.findFirst.mockResolvedValue({
        id: 'dc-1',
        code: 'EXPIRED',
        isActive: true,
        deletedAt: null,
        startsAt: null,
        expiresAt: pastDate,
        minOrderAmount: new Prisma.Decimal(0),
        usageLimit: null,
        perUserUsageLimit: null,
      });

      await expect(
        service.validate('EXPIRED', 'user-1', new Prisma.Decimal(1000)),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException if global usageLimit is exhausted', async () => {
      mockPrisma.discountCode.findFirst.mockResolvedValue({
        id: 'dc-1',
        code: 'MAXED',
        isActive: true,
        deletedAt: null,
        startsAt: null,
        expiresAt: null,
        minOrderAmount: new Prisma.Decimal(0),
        usageLimit: 10,
        usageCount: 10,
        perUserUsageLimit: null,
      });

      await expect(
        service.validate('MAXED', 'user-1', new Prisma.Decimal(1000)),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException if customer reached perUserUsageLimit', async () => {
      mockPrisma.discountCode.findFirst.mockResolvedValue({
        id: 'dc-1',
        code: 'USERLIMIT',
        isActive: true,
        deletedAt: null,
        startsAt: null,
        expiresAt: null,
        minOrderAmount: new Prisma.Decimal(0),
        usageLimit: 100,
        usageCount: 10,
        perUserUsageLimit: 1,
      });

      mockPrisma.discountCodeUserUsage.findUnique.mockResolvedValue({
        usageCount: 1,
      });

      await expect(
        service.validate('USERLIMIT', 'user-1', new Prisma.Decimal(1000)),
      ).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException if order amount is less than minOrderAmount', async () => {
      mockPrisma.discountCode.findFirst.mockResolvedValue({
        id: 'dc-1',
        code: 'BIGSPENDER',
        isActive: true,
        deletedAt: null,
        startsAt: null,
        expiresAt: null,
        minOrderAmount: new Prisma.Decimal(5000),
        usageLimit: null,
        perUserUsageLimit: null,
      });

      await expect(
        service.validate('BIGSPENDER', 'user-1', new Prisma.Decimal(3000)),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordUsage()', () => {
    it('locks row and records usage atomically inside transaction', async () => {
      const txMock: any = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: 'dc-1',
            usageLimit: 10,
            usageCount: 2,
            perUserUsageLimit: 2,
            isActive: true,
            deletedAt: null,
            startsAt: null,
            expiresAt: null,
          },
        ]),
        discountCodeUsage: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'dcu-1' }),
        },
        discountCodeUserUsage: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'user-usage-1', usageCount: 1 }),
          update: jest.fn(),
          upsert: jest.fn(),
        },
        discountCode: {
          update: jest.fn(),
        },
      };

      await service.recordUsage(
        'dc-1',
        'order-1',
        'user-1',
        new Prisma.Decimal(200),
        txMock,
      );

      // Verifies SELECT ... FOR UPDATE was executed to lock the row
      expect(txMock.$queryRaw).toHaveBeenCalled();
      // Verifies immutable discount usage history created
      expect(txMock.discountCodeUsage.create).toHaveBeenCalled();
      // Verifies global count incremented
      expect(txMock.discountCode.update).toHaveBeenCalledWith({
        where: { id: 'dc-1' },
        data: { usageCount: { increment: 1 } },
      });
    });

    it('returns early if idempotency check finds discount already recorded for this order', async () => {
      const txMock: any = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: 'dc-1',
            usageLimit: 10,
            usageCount: 2,
            perUserUsageLimit: 2,
            isActive: true,
            deletedAt: null,
            startsAt: null,
            expiresAt: null,
          },
        ]),
        discountCodeUsage: {
          findUnique: jest.fn().mockResolvedValue({ id: 'existing-usage-id' }),
          create: jest.fn(),
        },
        discountCode: {
          update: jest.fn(),
        },
      };

      await service.recordUsage(
        'dc-1',
        'order-1',
        'user-1',
        new Prisma.Decimal(200),
        txMock,
      );

      expect(txMock.discountCodeUsage.create).not.toHaveBeenCalled();
      expect(txMock.discountCode.update).not.toHaveBeenCalled();
    });
  });
});

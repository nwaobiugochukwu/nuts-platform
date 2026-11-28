import { BadRequestException } from '@nestjs/common';
import { DiscountCodeScope, DiscountCodeType, Prisma } from '@prisma/client';
import { DiscountCodeManagementService } from '../../services/discount-code-management.service';

const D = (n: number | string) => new Prisma.Decimal(n);

describe('DiscountCodeManagementService', () => {
  const baseCode = {
    id: 'dc1',
    code: 'SAVE20',
    isActive: true,
    deletedAt: null,
    startsAt: null,
    expiresAt: null,
    usageLimit: null,
    usageCount: 0,
    perUserUsageLimit: null,
    minOrderAmount: D(10_000),
    maxDiscountAmount: null,
    type: DiscountCodeType.PERCENTAGE,
    value: D(20),
    scope: DiscountCodeScope.PLATFORM,
    vendorId: null as string | null,
    platformwide: false,
    applicableProductIds: [] as string[],
    applicableCategoryIds: ['shoes'],
    firstOrderOnly: false,
  };

  const make = (existing?: unknown) => {
    const prisma = {
      discountCode: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    return {
      prisma,
      service: new DiscountCodeManagementService(prisma as never),
    };
  };

  describe('creating a code', () => {
    it('refuses a per-customer limit above the total limit', async () => {
      const { service, prisma } = make();

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
      expect(prisma.discountCode.create).not.toHaveBeenCalled();
    });

    it('refuses a percentage above 100', async () => {
      const { service, prisma } = make();

      await expect(
        service.create({
          code: 'OVER100',
          type: DiscountCodeType.PERCENTAGE,
          value: 150,
          platformwide: true,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.discountCode.create).not.toHaveBeenCalled();
    });
  });

  describe('updating a code', () => {
    it('changing only the value cannot push a percentage above 100', async () => {
      const { service } = make({
        ...baseCode,
        type: DiscountCodeType.PERCENTAGE,
        value: D(20),
      });

      await expect(
        service.update('dc1', { value: 150 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('switching a fixed code to a percentage re-checks the stored value', async () => {
      const { service } = make({
        ...baseCode,
        type: DiscountCodeType.FIXED,
        value: D(5000),
      });

      await expect(
        service.update('dc1', { type: DiscountCodeType.PERCENTAGE }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an expiry before the start date', async () => {
      const { service } = make({ ...baseCode });

      await expect(
        service.update('dc1', {
          startsAt: '2030-01-10T00:00:00.000Z',
          expiresAt: '2030-01-01T00:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('deactivating a code', () => {
    it('a non-admin without a vendor id can never fall through to an unscoped query', async () => {
      const { service, prisma } = make();

      await expect(
        service.deactivate('dc1', undefined, false),
      ).rejects.toThrow();
      expect(prisma.discountCode.findFirst).not.toHaveBeenCalled();
    });
  });
});

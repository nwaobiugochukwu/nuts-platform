import { BadRequestException } from '@nestjs/common';
import { DiscountCodeScope, DiscountCodeType, Prisma } from '@prisma/client';

import { DiscountCodeService } from './discount-code.service';
import {
  type DiscountLineItem,
  evaluateEligibleLines,
  isLineEligible,
} from './discount-eligibility';
import {
  computeVendorEarnings,
  loadVendorFundedDiscounts,
  releaseDiscountUsage,
} from './discount-funding';

const D = (n: number | string) => new Prisma.Decimal(n);

const line = (
  productId: string,
  vendorId: string,
  total: number,
  categoryIds: string[] = ['cat-1'],
): DiscountLineItem => ({
  productId,
  vendorId,
  categoryIds,
  lineTotal: D(total),
});

const code = (over: Record<string, unknown> = {}) => ({
  scope: DiscountCodeScope.PLATFORM,
  vendorId: null as string | null,
  platformwide: true,
  applicableProductIds: [] as string[],
  applicableCategoryIds: [] as string[],
  ...over,
});

describe('discount eligibility (shared engine)', () => {
  it('platform-wide code covers every line', () => {
    const r = evaluateEligibleLines(code(), [
      line('p1', 'vA', 1000),
      line('p2', 'vB', 4000),
    ]);
    expect(r.eligibleSubtotal.toNumber()).toBe(5000);
  });

  it('vendor code only discounts that vendor, never other stores in the cart', () => {
    const vendorCode = code({
      scope: DiscountCodeScope.VENDOR,
      vendorId: 'vA',
    });
    const r = evaluateEligibleLines(vendorCode, [
      line('p1', 'vA', 1000),
      line('p2', 'vB', 500_000),
    ]);
    expect(r.eligibleSubtotal.toNumber()).toBe(1000);
    expect(r.eligibleProductIds).toEqual(['p1']);
  });

  it('category-restricted code discounts only matching lines, not the whole cart', () => {
    const catCode = code({
      platformwide: false,
      applicableCategoryIds: ['shoes'],
    });
    const r = evaluateEligibleLines(catCode, [
      line('p1', 'vA', 5000, ['shoes']),
      line('p2', 'vA', 500_000, ['electronics']),
    ]);
    expect(r.eligibleSubtotal.toNumber()).toBe(5000);
  });

  it('a parent-category code also covers products in its sub-categories', () => {
    const catCode = code({
      platformwide: false,
      applicableCategoryIds: ['fashion'],
    });
    expect(
      isLineEligible(catCode, {
        productId: 'p1',
        vendorId: 'vA',
        categoryIds: ['sneakers', 'fashion'],
      }),
    ).toBe(true);
  });

  it('product and category lists are a union', () => {
    const c = code({
      platformwide: false,
      applicableProductIds: ['p9'],
      applicableCategoryIds: ['shoes'],
    });
    const r = evaluateEligibleLines(c, [
      line('p9', 'vA', 100, ['x']),
      line('p2', 'vA', 200, ['shoes']),
      line('p3', 'vA', 300, ['x']),
    ]);
    expect(r.eligibleSubtotal.toNumber()).toBe(300);
  });

  it('vendor code with a product list still cannot reach another vendor’s product', () => {
    const c = code({
      scope: DiscountCodeScope.VENDOR,
      vendorId: 'vA',
      platformwide: false,
      applicableProductIds: ['foreign'],
    });
    expect(
      isLineEligible(c, {
        productId: 'foreign',
        vendorId: 'vB',
        categoryIds: [],
      }),
    ).toBe(false);
  });
});

describe('vendor earnings with discount funding', () => {
  const items = [
    { vendorId: 'vA', quantity: 2, unitPrice: D(5000) }, // 10,000
    { vendorId: 'vB', quantity: 1, unitPrice: D(2000) },
  ];

  it('platform-funded discount leaves vendor earnings on the full price', () => {
    const e = computeVendorEarnings(items, 0.85);
    expect(e.get('vA')?.toNumber()).toBe(8500);
    expect(e.get('vB')?.toNumber()).toBe(1700);
  });

  it('vendor-funded discount reduces that vendor only', () => {
    const e = computeVendorEarnings(items, 0.85, new Map([['vA', D(2000)]]));
    expect(e.get('vA')?.toNumber()).toBe(6800); // (10000-2000)*0.85
    expect(e.get('vB')?.toNumber()).toBe(1700);
  });

  it('never goes negative', () => {
    const e = computeVendorEarnings(items, 0.85, new Map([['vB', D(99_999)]]));
    expect(e.get('vB')?.toNumber()).toBe(0);
  });

  it('loadVendorFundedDiscounts ignores platform-scoped usage', async () => {
    const client = {
      discountCodeUsage: {
        findMany: jest.fn().mockResolvedValue([
          {
            discountAmount: D(500),
            discountCode: { scope: 'PLATFORM', vendorId: null },
          },
          {
            discountAmount: D(300),
            discountCode: { scope: 'VENDOR', vendorId: 'vA' },
          },
        ]),
      },
    };
    const shares = await loadVendorFundedDiscounts(client as never, 'order-1');
    expect([...shares.entries()].map(([k, v]) => [k, v.toNumber()])).toEqual([
      ['vA', 300],
    ]);
  });
});

describe('releaseDiscountUsage', () => {
  const makeTx = (deleted: number) => ({
    discountCodeUsage: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'u1', discountCodeId: 'dc1', userId: 'user1' },
        ]),
      deleteMany: jest.fn().mockResolvedValue({ count: deleted }),
    },
    discountCode: { updateMany: jest.fn() },
    discountCodeUserUsage: { updateMany: jest.fn() },
    discountCodeClaim: { updateMany: jest.fn() },
  });

  it('decrements global and per-user counters once', async () => {
    const tx = makeTx(1);
    await releaseDiscountUsage(tx as never, 'order-1');
    expect(tx.discountCode.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.discountCodeUserUsage.updateMany).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a concurrent release that already removed the row does not decrement again', async () => {
    const tx = makeTx(0);
    await releaseDiscountUsage(tx as never, 'order-1');
    expect(tx.discountCode.updateMany).not.toHaveBeenCalled();
    expect(tx.discountCodeUserUsage.updateMany).not.toHaveBeenCalled();
  });
});

describe('DiscountCodeService.validateForCart / update validation', () => {
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
    vendorId: null,
    platformwide: false,
    applicableProductIds: [] as string[],
    applicableCategoryIds: ['shoes'],
    firstOrderOnly: false,
  };

  const makeService = (found: unknown, existing?: unknown) => {
    const prisma = {
      discountCode: {
        findFirst: jest.fn().mockResolvedValue(found),
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
      discountCodeUserUsage: { findUnique: jest.fn() },
      order: { count: jest.fn().mockResolvedValue(0) },
    };
    return {
      prisma,
      service: new DiscountCodeService(prisma as never),
    };
  };

  it('measures the minimum spend on ELIGIBLE items, not the whole cart', async () => {
    const { service } = makeService(baseCode);
    // Cart is ₦505,000 but only ₦5,000 is in the discounted category.
    await expect(
      service.validateForCart('SAVE20', 'u1', [
        line('p1', 'vA', 5000, ['shoes']),
        line('p2', 'vA', 500_000, ['electronics']),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('discounts only the eligible subtotal', async () => {
    const { service } = makeService({ ...baseCode, minOrderAmount: D(0) });
    const r = await service.validateForCart('SAVE20', 'u1', [
      line('p1', 'vA', 5000, ['shoes']),
      line('p2', 'vA', 500_000, ['electronics']),
    ]);
    expect(r.discountAmount.toNumber()).toBe(1000); // 20% of 5,000
  });

  it('rejects a code that matches nothing in the cart', async () => {
    const { service } = makeService({ ...baseCode, minOrderAmount: D(0) });
    await expect(
      service.validateForCart('SAVE20', 'u1', [
        line('p2', 'vA', 500_000, ['electronics']),
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update(): changing only `value` cannot push a percentage above 100', async () => {
    const { service } = makeService(null, {
      ...baseCode,
      type: DiscountCodeType.PERCENTAGE,
      value: D(20),
    });
    await expect(service.update('dc1', { value: 150 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('update(): switching a fixed code to PERCENTAGE re-validates the stored value', async () => {
    const { service } = makeService(null, {
      ...baseCode,
      type: DiscountCodeType.FIXED,
      value: D(5000),
    });
    await expect(
      service.update('dc1', { type: DiscountCodeType.PERCENTAGE }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update(): rejects an expiry before the start date', async () => {
    const { service } = makeService(null, { ...baseCode });
    await expect(
      service.update('dc1', {
        startsAt: '2030-01-10T00:00:00.000Z',
        expiresAt: '2030-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivate(): a non-admin without a vendor id can never fall through to an unscoped query', async () => {
    const { service, prisma } = makeService(null);
    await expect(service.deactivate('dc1', undefined, false)).rejects.toThrow();
    expect(prisma.discountCode.findFirst).not.toHaveBeenCalled();
  });
});

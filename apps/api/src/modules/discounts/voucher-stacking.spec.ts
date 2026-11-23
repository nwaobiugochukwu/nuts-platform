import { BadRequestException } from '@nestjs/common';
import { DiscountCodeScope, DiscountCodeType, Prisma } from '@prisma/client';

import { DiscountCodeService } from './discount-code.service';
import {
  type DiscountLineItem,
  allocateAcrossLines,
} from './discount-eligibility';

const D = (n: number | string) => new Prisma.Decimal(n);

const code = (over: Record<string, unknown>) => ({
  id: String(over.code),
  code: String(over.code),
  description: null,
  type: DiscountCodeType.PERCENTAGE,
  value: D(10),
  maxDiscountAmount: null,
  minOrderAmount: D(0),
  usageLimit: null,
  usageCount: 0,
  perUserUsageLimit: null,
  isActive: true,
  deletedAt: null,
  startsAt: null,
  expiresAt: null,
  firstOrderOnly: false,
  stackable: true,
  scope: DiscountCodeScope.PLATFORM,
  vendorId: null as string | null,
  platformwide: true,
  applicableProductIds: [] as string[],
  applicableCategoryIds: [] as string[],
  ...over,
});

const line = (
  productId: string,
  vendorId: string,
  total: number,
): DiscountLineItem => ({
  productId,
  vendorId,
  categoryIds: ['c1'],
  lineTotal: D(total),
});

function makeService(codes: Array<ReturnType<typeof code>>) {
  const byCode = new Map(codes.map((c) => [c.code, c]));
  const prisma = {
    discountCode: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { code: string } }) =>
          Promise.resolve(byCode.get(where.code) ?? null),
        ),
    },
    discountCodeClaim: { count: jest.fn().mockResolvedValue(0) },
    discountCodeUserUsage: { findUnique: jest.fn().mockResolvedValue(null) },
    order: { count: jest.fn().mockResolvedValue(0) },
  };
  return new DiscountCodeService(prisma as never);
}

describe('allocateAcrossLines', () => {
  it('spreads proportionally and always sums to exactly the discount', () => {
    const remaining = [D(100), D(200), D(300)];
    allocateAcrossLines(remaining, [0, 1, 2], D(100));
    const left = remaining.reduce((a, b) => a.add(b), D(0));
    expect(left.toNumber()).toBe(500);
    // proportional: line 0 gave ~16.67, line 2 ~50
    expect(remaining[0].toNumber()).toBeCloseTo(83.33, 1);
  });

  it('never takes more than a line has left', () => {
    const remaining = [D(10), D(10)];
    allocateAcrossLines(remaining, [0, 1], D(1000));
    expect(remaining.every((r) => r.greaterThanOrEqualTo(0))).toBe(true);
  });

  it('does not touch lines outside the eligible set', () => {
    const remaining = [D(100), D(100)];
    allocateAcrossLines(remaining, [0], D(40));
    expect(remaining[1].toNumber()).toBe(100);
    expect(remaining[0].toNumber()).toBe(60);
  });
});

describe('resolveVoucherStack', () => {
  const lines = [line('a1', 'vA', 10_000), line('b1', 'vB', 10_000)];

  const store = code({
    code: 'STORE20',
    scope: DiscountCodeScope.VENDOR,
    vendorId: 'vA',
    value: D(20),
  });
  const platform = code({ code: 'PLAT10', value: D(10) });

  it('applies the store voucher first, then the platform voucher on what is left', async () => {
    const svc = makeService([store, platform]);
    const r = await svc.resolveVoucherStack(
      ['PLAT10', 'STORE20'],
      'u1',
      lines,
      {
        strict: true,
      },
    );

    expect(r.applied.map((a) => a.discount.code)).toEqual([
      'STORE20',
      'PLAT10',
    ]);
    // store: 20% of vA's 10,000 = 2,000. platform: 10% of (8,000 + 10,000) = 1,800.
    expect(r.applied[0].discountAmount.toNumber()).toBe(2000);
    expect(r.applied[1].discountAmount.toNumber()).toBe(1800);
    expect(r.totalDiscount.toNumber()).toBe(3800);
  });

  it('the store voucher never discounts another store’s items', async () => {
    const svc = makeService([store]);
    const r = await svc.resolveVoucherStack(['STORE20'], 'u1', lines, {
      strict: true,
    });
    expect(r.totalDiscount.toNumber()).toBe(2000);
  });

  it('total discount can never exceed the goods total', async () => {
    const full = code({ code: 'FREE', value: D(100) });
    const store50 = code({
      code: 'S50',
      scope: DiscountCodeScope.VENDOR,
      vendorId: 'vA',
      value: D(50),
    });
    const svc = makeService([full, store50]);
    const r = await svc.resolveVoucherStack(['FREE', 'S50'], 'u1', lines, {
      strict: true,
    });
    // S50 takes 5,000 of vA first; FREE (100%) can only take what remains.
    expect(r.totalDiscount.toNumber()).toBe(20_000);
    expect(r.applied[1].discountAmount.toNumber()).toBe(15_000);
  });

  it('measures minimum spend on the original eligible subtotal, not what is left', async () => {
    const needsBig = code({
      code: 'BIG',
      value: D(10),
      minOrderAmount: D(15_000),
    });
    const svc = makeService([store, needsBig]);
    // After STORE20 only 18,000 remains, but the eligible subtotal was 20,000.
    await expect(
      svc.resolveVoucherStack(['STORE20', 'BIG'], 'u1', lines, {
        strict: true,
      }),
    ).resolves.toBeDefined();
  });

  it('refuses to combine when either code is not stackable', async () => {
    const exclusive = code({ code: 'ONLYME', stackable: false });
    const svc = makeService([exclusive, store]);
    await expect(
      svc.resolveVoucherStack(['ONLYME', 'STORE20'], 'u1', lines, {
        strict: true,
      }),
    ).rejects.toThrow(/can't be combined/);
  });

  it('refuses two vouchers of the same kind', async () => {
    const platform2 = code({ code: 'PLAT5', value: D(5) });
    const svc = makeService([platform, platform2]);
    await expect(
      svc.resolveVoucherStack(['PLAT10', 'PLAT5'], 'u1', lines, {
        strict: true,
      }),
    ).rejects.toThrow(/combine one store voucher with one platform voucher/);
  });

  it('refuses more than two vouchers', async () => {
    const svc = makeService([store, platform, code({ code: 'X3' })]);
    await expect(
      svc.resolveVoucherStack(['STORE20', 'PLAT10', 'X3'], 'u1', lines, {
        strict: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preview mode applies the valid voucher and reports the dropped one', async () => {
    const exclusive = code({ code: 'ONLYME', stackable: false });
    const svc = makeService([exclusive, platform]);
    const r = await svc.resolveVoucherStack(['PLAT10', 'ONLYME'], 'u1', lines, {
      strict: false,
    });
    expect(r.applied.map((a) => a.discount.code)).toEqual(['PLAT10']);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].code).toBe('ONLYME');
  });

  it('a single code behaves exactly as before', async () => {
    const svc = makeService([platform]);
    const one = await svc.validateForCart('PLAT10', 'u1', lines);
    expect(one.discountAmount.toNumber()).toBe(2000);
  });

  it('strict mode throws the underlying reason for an unknown code', async () => {
    const svc = makeService([platform]);
    await expect(
      svc.resolveVoucherStack(['NOPE'], 'u1', lines, { strict: true }),
    ).rejects.toThrow(/Invalid or inactive/);
  });
});

import { DiscountCodeScope, DiscountCodeType, Prisma } from '@prisma/client';

import { DiscountCodeService } from './discount-code.service';
import type { DiscountLineItem } from '../utils/discount-eligibility.util';

const D = (n: number | string) => new Prisma.Decimal(n);

const offer = (over: Record<string, unknown>) => ({
  id: String(over.code),
  code: String(over.code),
  description: null as string | null,
  type: DiscountCodeType.PERCENTAGE,
  value: D(10),
  maxDiscountAmount: null,
  minOrderAmount: D(0),
  minQuantity: null as number | null,
  usageLimit: null,
  usageCount: 0,
  perUserUsageLimit: null,
  isActive: true,
  deletedAt: null,
  startsAt: null,
  expiresAt: null,
  firstOrderOnly: false,
  stackable: false,
  autoApply: false,
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
  quantity = 1,
): DiscountLineItem => ({
  productId,
  vendorId,
  categoryIds: ['c1'],
  lineTotal: D(total),
  quantity,
});

function makeService(
  rows: Array<ReturnType<typeof offer>>,
  { priorOrders = 0 }: { priorOrders?: number } = {},
) {
  const byCode = new Map(rows.map((c) => [c.code, c]));
  const prisma = {
    discountCode: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { code: string } }) =>
          Promise.resolve(byCode.get(where.code) ?? null),
        ),
      findMany: jest
        .fn()
        .mockResolvedValue(rows.filter((row) => row.autoApply === true)),
    },
    discountCodeClaim: { count: jest.fn().mockResolvedValue(0) },
    discountCodeUserUsage: { findUnique: jest.fn().mockResolvedValue(null) },
    order: { count: jest.fn().mockResolvedValue(priorOrders) },
  };
  return new DiscountCodeService(prisma as never);
}

const resolve = (
  svc: DiscountCodeService,
  codes: string[],
  lines: DiscountLineItem[],
) =>
  svc.resolveVoucherStack(codes, 'u1', lines, {
    strict: false,
    includeAutomatic: true,
  });

describe('automatic discounts', () => {
  const lines = [line('a1', 'vA', 10_000)];

  it('applies with no code when the cart qualifies', async () => {
    const auto = offer({ code: 'AUTO-1', autoApply: true, value: D(10) });
    const r = await resolve(makeService([auto]), [], lines);
    expect(r.applied.map((a) => a.discount.code)).toEqual(['AUTO-1']);
    expect(r.totalDiscount.toNumber()).toBe(1000);
    expect(r.rejected).toEqual([]);
  });

  it('does nothing when automatic discounts are not requested', async () => {
    const auto = offer({ code: 'AUTO-1', autoApply: true });
    const r = await makeService([auto]).resolveVoucherStack([], 'u1', lines, {
      strict: false,
    });
    expect(r.applied).toEqual([]);
  });

  it('meets the spend target before applying', async () => {
    const auto = offer({
      code: 'AUTO-1',
      autoApply: true,
      minOrderAmount: D(20_000),
    });
    const r = await resolve(makeService([auto]), [], lines);
    expect(r.applied).toEqual([]);
  });

  it('meets the quantity target before applying ("buy 3")', async () => {
    const auto = offer({ code: 'AUTO-3', autoApply: true, minQuantity: 3 });
    const svc = makeService([auto]);
    expect(
      (await resolve(svc, [], [line('a1', 'vA', 6_000, 2)])).applied,
    ).toEqual([]);
    expect(
      (await resolve(svc, [], [line('a1', 'vA', 9_000, 3)])).applied.map(
        (a) => a.discount.code,
      ),
    ).toEqual(['AUTO-3']);
  });

  it('keeps the shopper’s code when it saves more than the automatic offer', async () => {
    const auto = offer({ code: 'AUTO-1', autoApply: true, value: D(5) });
    const typed = offer({ code: 'BIG20', value: D(20) });
    const r = await resolve(makeService([auto, typed]), ['BIG20'], lines);
    expect(r.applied.map((a) => a.discount.code)).toEqual(['BIG20']);
    expect(r.rejected).toEqual([]);
  });

  it('applies the better automatic offer and says the code was not used', async () => {
    const auto = offer({ code: 'AUTO-1', autoApply: true, value: D(30) });
    const typed = offer({ code: 'SMALL5', value: D(5) });
    const r = await resolve(makeService([auto, typed]), ['SMALL5'], lines);
    expect(r.applied.map((a) => a.discount.code)).toEqual(['AUTO-1']);
    expect(r.rejected.map((x) => x.code)).toEqual(['SMALL5']);
    expect(r.rejected[0].error.message).toMatch(/better automatic offer/i);
  });

  it('combines an automatic offer with a voucher when both are combinable', async () => {
    const auto = offer({
      code: 'AUTO-1',
      autoApply: true,
      stackable: true,
      value: D(10),
    });
    const store = offer({
      code: 'STORE10',
      stackable: true,
      scope: DiscountCodeScope.VENDOR,
      vendorId: 'vA',
      value: D(10),
    });
    const r = await resolve(makeService([auto, store]), ['STORE10'], lines);
    expect(r.applied.map((a) => a.discount.code).sort()).toEqual([
      'AUTO-1',
      'STORE10',
    ]);
    // 10% store, then 10% platform on what is left: 1000 + 900.
    expect(r.totalDiscount.toNumber()).toBe(1900);
  });

  it('does not stack an exclusive automatic offer with a voucher', async () => {
    const auto = offer({ code: 'AUTO-1', autoApply: true, value: D(10) });
    const store = offer({
      code: 'STORE10',
      stackable: true,
      scope: DiscountCodeScope.VENDOR,
      vendorId: 'vA',
      value: D(10),
    });
    const r = await resolve(makeService([auto, store]), ['STORE10'], lines);
    expect(r.applied).toHaveLength(1);
  });

  it('never gives a first-order-only automatic offer to a returning customer', async () => {
    const auto = offer({
      code: 'AUTO-1',
      autoApply: true,
      firstOrderOnly: true,
    });
    const first = await resolve(makeService([auto]), [], lines);
    const returning = await resolve(
      makeService([auto], { priorOrders: 2 }),
      [],
      lines,
    );
    expect(first.applied).toHaveLength(1);
    expect(returning.applied).toEqual([]);
  });

  it('lets a store offer cover only that store’s items', async () => {
    const auto = offer({
      code: 'AUTO-1',
      autoApply: true,
      scope: DiscountCodeScope.VENDOR,
      vendorId: 'vA',
      value: D(10),
    });
    const r = await resolve(
      makeService([auto]),
      [],
      [line('a1', 'vA', 10_000), line('b1', 'vB', 10_000)],
    );
    expect(r.totalDiscount.toNumber()).toBe(1000);
  });

  it('refuses a typed code that belongs to an automatic offer', async () => {
    const auto = offer({ code: 'AUTO-1', autoApply: true });
    const r = await makeService([auto]).resolveVoucherStack(
      ['AUTO-1'],
      'u1',
      lines,
      { strict: false },
    );
    expect(r.applied).toEqual([]);
    expect(r.rejected[0].error.message).toMatch(/applies automatically/i);
  });
});

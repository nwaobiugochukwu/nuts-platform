import { DiscountClaimStatus } from '@prisma/client';

import { DiscountCodeService } from './discount-code.service';
import { VoucherClaimsService } from './voucher-claims.service';

describe('discounts a customer has used up', () => {
  it('finds only codes whose per-customer limit is reached', async () => {
    const prisma = {
      discountCode: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'once', perUserUsageLimit: 1 },
          { id: 'thrice', perUserUsageLimit: 3 },
        ]),
      },
      discountCodeUserUsage: {
        findMany: jest.fn().mockResolvedValue([
          { discountCodeId: 'once', usageCount: 1 }, // used up
          { discountCodeId: 'thrice', usageCount: 2 }, // one use left
        ]),
      },
    };
    const service = new DiscountCodeService(prisma as never);

    const exhausted = await service.findExhaustedCodeIds('u1', [
      'once',
      'thrice',
      'unlimited',
    ]);

    expect([...exhausted]).toEqual(['once']);
  });

  it('does nothing for guests or an empty list (no queries)', async () => {
    const prisma = {
      discountCode: { findMany: jest.fn() },
      discountCodeUserUsage: { findMany: jest.fn() },
    };
    const service = new DiscountCodeService(prisma as never);

    expect((await service.findExhaustedCodeIds(undefined, ['a'])).size).toBe(0);
    expect((await service.findExhaustedCodeIds('u1', [])).size).toBe(0);
    expect(prisma.discountCode.findMany).not.toHaveBeenCalled();
  });

  it('lists a used-up voucher as USED in the wallet and keeps usable ones ACTIVE', async () => {
    const code = (id: string, limit: number | null) => ({
      id,
      code: id.toUpperCase(),
      description: null,
      type: 'PERCENTAGE',
      value: 10,
      minOrderAmount: 0,
      maxDiscountAmount: null,
      stackable: false,
      firstOrderOnly: false,
      scope: 'PLATFORM',
      startsAt: null,
      perUserUsageLimit: limit,
      vendorId: null,
      platformwide: true,
      applicableProductIds: [],
      applicableCategoryIds: [],
    });
    const claim = (id: string, limit: number | null, status: string) => ({
      discountCodeId: id,
      status,
      claimedAt: new Date('2026-11-01'),
      updatedAt: new Date('2026-11-02'),
      expiresAt: new Date(Date.now() + 3600_000),
      discountCode: code(id, limit),
    });

    const prisma = {
      discountCodeClaim: {
        findMany: jest
          .fn()
          // 1st call: ACTIVE claims; 2nd call: REDEEMED claims
          .mockResolvedValueOnce([
            claim('fresh', 1, DiscountClaimStatus.ACTIVE),
          ])
          .mockResolvedValueOnce([
            claim('spent', 1, DiscountClaimStatus.REDEEMED),
          ]),
      },
      discountCodeUserUsage: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ discountCodeId: 'spent', usageCount: 1 }]),
      },
      vendor: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      category: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new VoucherClaimsService(prisma as never);

    const wallet = await service.list('u1');

    expect(wallet.map((v) => [v.code, v.status])).toEqual([
      ['FRESH', 'ACTIVE'],
      ['SPENT', 'USED'],
    ]);
    expect(wallet[1].usedAt).toBeInstanceOf(Date);
  });
});

import { DiscountClaimStatus } from '@prisma/client';

import { FirstOrderEligibilityService } from './first-order-eligibility.service';
import { PublicPromotionsService } from './public-promotions.service';
import { VoucherClaimsService } from './voucher-claims.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';

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
    const service = new PublicPromotionsService(
      prisma as never,
      new FirstOrderEligibilityService(prisma as never),
    );

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
    const service = new PublicPromotionsService(
      prisma as never,
      new FirstOrderEligibilityService(prisma as never),
    );

    expect((await service.findExhaustedCodeIds(undefined, ['a'])).size).toBe(0);
    expect((await service.findExhaustedCodeIds('u1', [])).size).toBe(0);
    expect(prisma.discountCode.findMany).not.toHaveBeenCalled();
  });

  it('keeps a used-up campaign in the banner list, flagged and last, instead of dropping it', async () => {
    const row = (
      id: string,
      code: string,
      value: number,
      limit: number | null,
    ) => ({
      id,
      code,
      description: `${code} offer`,
      type: 'PERCENTAGE',
      value,
      maxDiscountAmount: null,
      minOrderAmount: 0,
      startsAt: null,
      expiresAt: null,
      usageLimit: null,
      usageCount: 0,
      perUserUsageLimit: limit,
      firstOrderOnly: false,
      autoApply: false,
      createdAt: new Date('2026-11-01'),
    });
    const campaigns = [
      row('used', 'BIGGEST', 50, 1),
      row('open', 'OPEN10', 10, null),
    ];
    const prisma = {
      order: { count: jest.fn().mockResolvedValue(0) },
      discountCode: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }: { where: { id?: unknown } }) =>
            Promise.resolve(
              where.id ? [{ id: 'used', perUserUsageLimit: 1 }] : campaigns,
            ),
          ),
      },
      discountCodeUserUsage: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ discountCodeId: 'used', usageCount: 1 }]),
      },
    };
    const service = new PublicPromotionsService(
      prisma as never,
      new FirstOrderEligibilityService(prisma as never),
    );

    const promos = await service.getPublicPlatformPromos('u1');

    // Both are still listed (nothing disappears), the used one is flagged and sorted last
    // even though it is the bigger offer.
    expect(promos.map((p) => [p.code, !!p.usedByYou])).toEqual([
      ['OPEN10', false],
      ['BIGGEST', true],
    ]);
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
    const service = new VoucherClaimsService(
      prisma as never,
      new TransactionRunnerService(prisma as never, {} as never),
    );

    const wallet = await service.list('u1');

    expect(wallet.map((v) => [v.code, v.status])).toEqual([
      ['FRESH', 'ACTIVE'],
      ['SPENT', 'USED'],
    ]);
    expect(wallet[1].usedAt).toBeInstanceOf(Date);
  });
});

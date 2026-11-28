import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DiscountCodeType, Prisma } from '@prisma/client';

import { DiscountCodeService } from './discount-code.service';
import { CLAIM_TTL_MS, VoucherClaimsService } from './voucher-claims.service';
import { TransactionRunnerService } from '@api/infrastructure/database/transaction-runner.service';

const D = (n: number) => new Prisma.Decimal(n);

const baseCode = (over: Record<string, unknown> = {}) => ({
  id: 'dc1',
  code: 'FLASH50',
  description: null,
  type: DiscountCodeType.PERCENTAGE,
  value: D(10),
  minOrderAmount: D(0),
  maxDiscountAmount: null,
  stackable: false,
  firstOrderOnly: false,
  scope: 'PLATFORM',
  startsAt: null,
  expiresAt: null,
  usageLimit: null as number | null,
  usageCount: 0,
  perUserUsageLimit: null as number | null,
  isActive: true,
  deletedAt: null,
  vendorId: null as string | null,
  platformwide: true,
  applicableProductIds: [] as string[],
  applicableCategoryIds: [] as string[],
  ...over,
});

function make(
  code: ReturnType<typeof baseCode> | null,
  opts: {
    othersReserved?: number;
    priorOrders?: number;
    userUsage?: number | null;
  } = {},
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue(code ? [{ id: code.id }] : []),
    discountCode: { findFirst: jest.fn().mockResolvedValue(code) },
    order: { count: jest.fn().mockResolvedValue(opts.priorOrders ?? 0) },
    discountCodeUserUsage: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.userUsage == null ? null : { usageCount: opts.userUsage },
        ),
    },
    discountCodeClaim: {
      count: jest.fn().mockResolvedValue(opts.othersReserved ?? 0),
      upsert: jest.fn().mockImplementation(({ create }) =>
        Promise.resolve({
          claimedAt: new Date(),
          expiresAt: create.expiresAt,
        }),
      ),
    },
  };
  const prisma = {
    $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    vendor: { findMany: jest.fn().mockResolvedValue([]) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    category: { findMany: jest.fn().mockResolvedValue([]) },
    discountCodeClaim: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    tx,
    prisma,
    service: new VoucherClaimsService(
      prisma as never,
      new TransactionRunnerService(prisma as never, {} as never),
    ),
  };
}

describe('VoucherClaimsService', () => {
  it('rejects an unknown code', async () => {
    const { service } = make(null);
    await expect(service.claim('u1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('normalises the code and holds the claim for 24 hours', async () => {
    const { service, tx } = make(baseCode());
    const before = Date.now();
    await service.claim('u1', ' flash50 ');
    const create = tx.discountCodeClaim.upsert.mock.calls[0][0].create;
    expect(create.userId).toBe('u1');
    const held = create.expiresAt.getTime() - before;
    expect(held).toBeGreaterThan(CLAIM_TTL_MS - 5_000);
    expect(held).toBeLessThanOrEqual(CLAIM_TTL_MS + 5_000);
  });

  it('never holds a reservation past the code’s own expiry', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    const { service, tx } = make(baseCode({ expiresAt: soon }));
    await service.claim('u1', 'FLASH50');
    expect(
      tx.discountCodeClaim.upsert.mock.calls[0][0].create.expiresAt.getTime(),
    ).toBe(soon.getTime());
  });

  it('refuses a code that has not started or has expired', async () => {
    const future = new Date(Date.now() + 3_600_000);
    const past = new Date(Date.now() - 3_600_000);
    await expect(
      make(baseCode({ startsAt: future })).service.claim('u1', 'FLASH50'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      make(baseCode({ expiresAt: past })).service.claim('u1', 'FLASH50'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses first-order-only vouchers to repeat customers', async () => {
    const { service } = make(baseCode({ firstOrderOnly: true }), {
      priorOrders: 2,
    });
    await expect(service.claim('u1', 'FLASH50')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses when the customer already used it the maximum number of times', async () => {
    const { service } = make(baseCode({ perUserUsageLimit: 1 }), {
      userUsage: 1,
    });
    await expect(service.claim('u1', 'FLASH50')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  describe('reservation of limited vouchers', () => {
    it('refuses the last unit when others hold the remaining reservations', async () => {
      // 10 total, 7 redeemed, 3 reserved by others -> nothing left for me.
      const { service } = make(baseCode({ usageLimit: 10, usageCount: 7 }), {
        othersReserved: 3,
      });
      await expect(service.claim('u1', 'FLASH50')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('allows a claim while at least one unit is unreserved', async () => {
      const { service, tx } = make(
        baseCode({ usageLimit: 10, usageCount: 7 }),
        {
          othersReserved: 2,
        },
      );
      await expect(service.claim('u1', 'FLASH50')).resolves.toMatchObject({
        code: 'FLASH50',
      });
      expect(tx.discountCodeClaim.upsert).toHaveBeenCalled();
    });

    it('counts only OTHER customers’ live claims (a re-claim cannot lock you out of your own slot)', async () => {
      const { service, tx } = make(baseCode({ usageLimit: 1, usageCount: 0 }), {
        othersReserved: 0,
      });
      await service.claim('u1', 'FLASH50');
      const where = tx.discountCodeClaim.count.mock.calls[0][0].where;
      expect(where.userId).toEqual({ not: 'u1' });
      expect(where.status).toBe('ACTIVE');
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
    });

    it('unlimited vouchers take no reservation count at all', async () => {
      const { service, tx } = make(baseCode({ usageLimit: null }));
      await service.claim('u1', 'FLASH50');
      expect(tx.discountCodeClaim.count).not.toHaveBeenCalled();
    });
  });

  it('release only touches ACTIVE claims', async () => {
    const { service, prisma } = make(baseCode());
    await service.release('u1', ' flash50 ');
    const where = prisma.discountCodeClaim.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      userId: 'u1',
      status: 'ACTIVE',
      discountCode: { code: 'FLASH50' },
    });
  });
});

describe('DiscountCodeService.validate honours reservations', () => {
  const make2 = (
    reservedByOthers: number,
    code = baseCode({ usageLimit: 5, usageCount: 3 }),
  ) => {
    const prisma = {
      discountCode: { findFirst: jest.fn().mockResolvedValue(code) },
      discountCodeClaim: {
        count: jest.fn().mockResolvedValue(reservedByOthers),
      },
      discountCodeUserUsage: { findUnique: jest.fn() },
      order: { count: jest.fn().mockResolvedValue(0) },
    };
    return new DiscountCodeService(prisma as never);
  };

  it('blocks a shopper when others have reserved every remaining use', async () => {
    await expect(make2(2).validate('FLASH50', 'u1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('lets the shopper through when a use is still free for them', async () => {
    await expect(make2(1).validate('FLASH50', 'u1')).resolves.toMatchObject({
      code: 'FLASH50',
    });
  });
});

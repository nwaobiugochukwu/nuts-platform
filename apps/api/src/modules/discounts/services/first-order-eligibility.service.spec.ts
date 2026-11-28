import { OrderStatus } from '@prisma/client';
import { isFirstOrderOnlyDiscount } from '../utils/first-order.util';
import { FirstOrderEligibilityService } from './first-order-eligibility.service';

describe('FirstOrderEligibilityService', () => {
  const prismaWith = (count: number) => ({
    order: { count: jest.fn().mockResolvedValue(count) },
  });

  it('says a shopper with an order that was not cancelled is not a first-time shopper', async () => {
    const prisma = prismaWith(2);
    const service = new FirstOrderEligibilityService(prisma as never);

    await expect(service.hasPriorOrders('u1')).resolves.toBe(true);
    expect(prisma.order.count).toHaveBeenCalledWith({
      where: { userId: 'u1', status: { not: OrderStatus.CANCELLED } },
    });
  });

  it('says a shopper with no orders, or only cancelled ones, is still a first-time shopper', async () => {
    await expect(
      new FirstOrderEligibilityService(prismaWith(0) as never).hasPriorOrders(
        'u1',
      ),
    ).resolves.toBe(false);
  });

  it('treats a guest as a first-time shopper, without asking the database', async () => {
    const prisma = prismaWith(5);

    await expect(
      new FirstOrderEligibilityService(prisma as never).hasPriorOrders(
        undefined,
      ),
    ).resolves.toBe(false);
    expect(prisma.order.count).not.toHaveBeenCalled();
  });

  it('answers from the cache when there is one, and forgets the answer on request', async () => {
    const prisma = prismaWith(1);
    const cache = {
      wrap: jest.fn(
        (_key: string, _ttl: number, load: () => Promise<boolean>) => load(),
      ),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const service = new FirstOrderEligibilityService(
      prisma as never,
      cache as never,
    );

    await service.hasPriorOrders('u1');
    await service.invalidate('u1');

    expect(cache.wrap).toHaveBeenCalledWith(
      'user:has-prior-orders:u1',
      300,
      expect.any(Function),
    );
    expect(cache.del).toHaveBeenCalledWith('user:has-prior-orders:u1');
  });

  it('invalidating with no cache is harmless', async () => {
    await expect(
      new FirstOrderEligibilityService(prismaWith(0) as never).invalidate('u1'),
    ).resolves.toBeUndefined();
  });
});

describe('isFirstOrderOnlyDiscount', () => {
  it('is true only for an offer explicitly reserved for first orders', () => {
    expect(isFirstOrderOnlyDiscount({ firstOrderOnly: true })).toBe(true);
    expect(isFirstOrderOnlyDiscount({ firstOrderOnly: false })).toBe(false);
    expect(isFirstOrderOnlyDiscount({})).toBe(false);
  });
});

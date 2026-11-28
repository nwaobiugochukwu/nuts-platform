import { fakeCronRedis } from '@api/infrastructure/cache/cron-lock-harness-spec';
import { AbandonedCartPurgeJob } from '../../jobs/abandoned-cart-purge.job';

const DAY = 24 * 60 * 60 * 1000;

describe('AbandonedCartPurgeJob', () => {
  let prisma: { cart: { findMany: jest.Mock; deleteMany: jest.Mock } };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-27T00:00:00.000Z'));
    prisma = {
      cart: { findMany: jest.fn(), deleteMany: jest.fn() },
    };
  });

  afterEach(() => jest.useRealTimers());

  function build(redisOptions = {}) {
    const { redis, set } = fakeCronRedis(redisOptions);
    const cron = new AbandonedCartPurgeJob(prisma as never, redis);
    jest.spyOn((cron as any).logger, 'log').mockImplementation(() => undefined);
    jest
      .spyOn((cron as any).logger, 'error')
      .mockImplementation(() => undefined);
    return { cron, set };
  }

  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));

  it('deletes carts untouched for 30 days that were never checked out', async () => {
    prisma.cart.findMany.mockResolvedValue(ids(3));
    prisma.cart.deleteMany.mockResolvedValue({ count: 3 });
    const { cron, set } = build();

    await cron.purgeAbandonedCarts();

    expect(prisma.cart.findMany).toHaveBeenCalledWith({
      where: {
        checkedOut: false,
        updatedAt: { lte: new Date(Date.now() - 30 * DAY) },
      },
      select: { id: true },
      take: 1000,
    });
    expect(prisma.cart.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['c0', 'c1', 'c2'] } },
    });
    expect(set).toHaveBeenCalledWith(
      'cron:lock:abandoned-cart-purge',
      expect.any(String),
      'PX',
      1_800_000,
      'NX',
    );
    expect((cron as any).logger.log).toHaveBeenCalledWith(
      'Purged 3 abandoned carts',
    );
  });

  it('does nothing when there are no old carts', async () => {
    prisma.cart.findMany.mockResolvedValue([]);
    const { cron } = build();

    await cron.purgeAbandonedCarts();

    expect(prisma.cart.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps going while batches are full and stops at the first short batch', async () => {
    prisma.cart.findMany
      .mockResolvedValueOnce(ids(1000))
      .mockResolvedValueOnce(ids(1000))
      .mockResolvedValueOnce(ids(10));
    prisma.cart.deleteMany.mockResolvedValue({ count: 1000 });
    const { cron } = build();

    await cron.purgeAbandonedCarts();

    expect(prisma.cart.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.cart.deleteMany).toHaveBeenCalledTimes(3);
  });

  it('stops after 200 batches in one run', async () => {
    prisma.cart.findMany.mockResolvedValue(ids(1000));
    prisma.cart.deleteMany.mockResolvedValue({ count: 1000 });
    const { cron } = build();

    await cron.purgeAbandonedCarts();

    expect(prisma.cart.findMany).toHaveBeenCalledTimes(200);
  });

  it('does nothing when another process holds the lock', async () => {
    const { cron } = build({ alreadyLocked: true });

    await cron.purgeAbandonedCarts();

    expect(prisma.cart.findMany).not.toHaveBeenCalled();
  });

  it('logs a failure and does not throw', async () => {
    prisma.cart.findMany.mockRejectedValue(new Error('db down'));
    const { cron } = build();

    await expect(cron.purgeAbandonedCarts()).resolves.toBeUndefined();
    expect((cron as any).logger.error).toHaveBeenCalledWith(
      'Failed to purge abandoned carts',
      expect.any(String),
    );
  });
});

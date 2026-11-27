import { NotificationType, Prisma, ROLE } from '@prisma/client';
import { fakeRetentionRedis } from '@api/infrastructure/redis/retention-lock-harness-spec';
import { WishlistAlertsCron } from './wishlist-alerts.cron';

describe('WishlistAlertsCron', () => {
  let prisma: {
    wishlistItem: { findMany: jest.Mock; updateMany: jest.Mock };
    productVariant: { groupBy: jest.Mock };
  };
  let notifications: { create: jest.Mock };
  const observedAt = new Date('2026-11-26T10:00:00.000Z');

  const item = (overrides: Record<string, unknown> = {}) => ({
    id: 'w1',
    userId: 'u1',
    productId: 'p1',
    variantId: null,
    lastObservedPrice: new Prisma.Decimal('1000'),
    lastObservedStock: 5,
    lastObservedAt: observedAt,
    variant: null,
    product: {
      id: 'p1',
      name: 'Red Shoe',
      slug: 'red-shoe',
      price: new Prisma.Decimal('1000'),
      stock: 5,
      hasVariants: false,
    },
    ...overrides,
  });

  const withProduct = (
    product: Record<string, unknown>,
    rest: Record<string, unknown> = {},
  ) => item({ product: { ...item().product, ...product }, ...rest });

  beforeEach(() => {
    prisma = {
      wishlistItem: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productVariant: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
  });

  function build(redisOptions = {}) {
    const harness = fakeRetentionRedis(redisOptions);
    const cron = new WishlistAlertsCron(
      prisma as never,
      notifications as never,
      harness.redis,
    );
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn((cron as any).logger, level)
        .mockImplementation(() => undefined);
    }
    return { cron, ...harness };
  }

  const runWith = async (items: unknown[], redisOptions = {}) => {
    prisma.wishlistItem.findMany
      .mockResolvedValueOnce(items)
      .mockResolvedValue([]);
    const built = build(redisOptions);
    await built.cron.handleWishlistAlerts();
    return built;
  };

  it('tells the shopper when a saved item got cheaper, once per snapshot', async () => {
    await runWith([withProduct({ price: new Prisma.Decimal('800') })]);

    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        role: ROLE.USER,
        type: NotificationType.PRICE_DROP,
        message: 'Red Shoe dropped to ₦800.00.',
        link: '/product/red-shoe',
        dedupeKey: `wishlist:w1:price-drop:${observedAt.toISOString()}`,
        metadata: {
          productId: 'p1',
          previousPrice: '1000',
          currentPrice: '800',
        },
      }),
    );
  });

  it('tells the shopper when an out-of-stock item is available again', async () => {
    await runWith([item({ lastObservedStock: 0 })]);

    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.RESTOCKED,
        dedupeKey: `wishlist:w1:restocked:${observedAt.toISOString()}`,
        metadata: { productId: 'p1', previousStock: 0, currentStock: 5 },
      }),
    );
  });

  it('sends both alerts when the price dropped and the item is back in stock', async () => {
    await runWith([
      withProduct(
        { price: new Prisma.Decimal('500') },
        { lastObservedStock: 0 },
      ),
    ]);

    expect(notifications.create.mock.calls.map((c) => c[0].type)).toEqual([
      NotificationType.PRICE_DROP,
      NotificationType.RESTOCKED,
    ]);
  });

  it('says nothing when the price rose or nothing changed', async () => {
    await runWith([
      withProduct({ price: new Prisma.Decimal('1500') }),
      item({ id: 'w2' }),
    ]);

    expect(notifications.create).not.toHaveBeenCalled();
    expect(prisma.wishlistItem.updateMany).not.toHaveBeenCalled();
  });

  it('moves the saved snapshot forward only if nobody changed it meanwhile', async () => {
    await runWith([withProduct({ price: new Prisma.Decimal('800') })]);

    const args = prisma.wishlistItem.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({
      id: 'w1',
      lastObservedAt: observedAt,
      lastObservedPrice: new Prisma.Decimal('1000'),
      lastObservedStock: 5,
    });
    expect(args.data.lastObservedPrice).toEqual(new Prisma.Decimal('800'));
    expect(args.data.lastObservedStock).toBe(5);
  });

  it('uses the variant stock for a saved variant, and treats an inactive variant as out of stock', async () => {
    await runWith([
      item({
        id: 'a',
        variantId: 'v1',
        lastObservedStock: 0,
        variant: { stock: 3, isActive: true, isDeleted: false },
      }),
      item({
        id: 'b',
        variantId: 'v2',
        lastObservedStock: 0,
        variant: { stock: 9, isActive: false, isDeleted: false },
      }),
      item({
        id: 'c',
        variantId: 'v3',
        lastObservedStock: 0,
        variant: { stock: 9, isActive: true, isDeleted: true },
      }),
    ]);

    const restocked = notifications.create.mock.calls.filter(
      (c) => c[0].type === NotificationType.RESTOCKED,
    );
    expect(restocked.map((c) => c[0].dedupeKey.split(':')[1])).toEqual(['a']);
  });

  it('uses the summed variant stock for a product with variants when no variant was saved', async () => {
    prisma.productVariant.groupBy.mockResolvedValue([
      { productId: 'p1', _sum: { stock: 7 } },
    ]);

    await runWith([
      withProduct({ hasVariants: true, stock: 0 }, { lastObservedStock: 0 }),
    ]);

    expect(prisma.productVariant.groupBy).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.RESTOCKED,
        metadata: expect.objectContaining({ currentStock: 7 }),
      }),
    );
  });

  it('never counts negative stock', async () => {
    await runWith([withProduct({ stock: -4 }, { lastObservedStock: 0 })]);

    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('pages through the wishlist with a cursor until it is empty', async () => {
    prisma.wishlistItem.findMany
      .mockResolvedValueOnce([item({ id: 'w1' }), item({ id: 'w2' })])
      .mockResolvedValueOnce([item({ id: 'w3' })])
      .mockResolvedValueOnce([]);
    const { cron, renewals } = build();

    await cron.handleWishlistAlerts();

    const wheres = prisma.wishlistItem.findMany.mock.calls.map(
      (c) => c[0].where,
    );
    expect(wheres[0].id).toBeUndefined();
    expect(wheres[1].id).toEqual({ gt: 'w2' });
    expect(wheres[2].id).toEqual({ gt: 'w3' });
    expect(renewals()).toBe(3);
  });

  it('only watches active products of active, approved vendors', async () => {
    await runWith([]);

    expect(prisma.wishlistItem.findMany.mock.calls[0][0].where.product).toEqual(
      {
        isActive: true,
        isDeleted: false,
        vendor: { isActive: true, isApproved: true },
      },
    );
  });

  it('does nothing when another process holds the lock', async () => {
    const { cron } = build({ alreadyLocked: true });

    await cron.handleWishlistAlerts();

    expect(prisma.wishlistItem.findMany).not.toHaveBeenCalled();
  });

  it('stops when it discovers it lost the lock, and releases it', async () => {
    const { cron, releases } = build({ lockLostOnRenew: true });

    await cron.handleWishlistAlerts();

    expect(prisma.wishlistItem.findMany).not.toHaveBeenCalled();
    expect(releases()).toBe(1);
  });

  it('keeps the old snapshot when the notification fails, so the next run tries again', async () => {
    notifications.create.mockRejectedValue(new Error('db down'));

    const { releases } = await runWith([
      withProduct({ price: new Prisma.Decimal('800') }),
    ]);

    expect(prisma.wishlistItem.updateMany).not.toHaveBeenCalled();
    expect(releases()).toBe(1);
  });
});

import { Prisma } from '@prisma/client';
import type { ShopperActivity } from '../types/shopper-activity.types';
import { ShopperActivityStoreService } from './shopper-activity-store.service';

const missingRow = () =>
  new Prisma.PrismaClientKnownRequestError('fk', {
    code: 'P2003',
    clientVersion: 'test',
  });

describe('ShopperActivityStoreService', () => {
  let prisma: any;
  let refresh: { schedule: jest.Mock };
  let service: ShopperActivityStoreService;
  const at = new Date('2026-11-28T10:00:00.000Z');

  const table = () => ({
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
  });
  const act = (over: Partial<ShopperActivity>): ShopperActivity => ({
    id: 'a1',
    action: 'product_viewed',
    productId: 'p1',
    userId: 'u1',
    sessionId: 's1',
    ...over,
  });

  beforeEach(() => {
    prisma = {
      productView: table(),
      searchQuery: table(),
      recommendationEvent: table(),
      shopperActivity: table(),
    };
    refresh = { schedule: jest.fn() };
    service = new ShopperActivityStoreService(prisma, refresh as never);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  it.each([
    ['product_viewed', 'productView', {}],
    ['searched', 'searchQuery', { query: 'shoes' }],
    ['shelf_item_clicked', 'recommendationEvent', { surface: 'HOME_FOR_YOU' }],
    [
      'category_viewed',
      'recommendationEvent',
      { surface: 'HOME', categoryId: 'c1' },
    ],
    ['store_viewed', 'shopperActivity', { vendorId: 'v1' }],
    ['cart_item_added', 'shopperActivity', { quantity: 1 }],
    ['wishlist_item_removed', 'shopperActivity', {}],
  ] as const)(
    'stores %s in %s, under its id, skipping duplicates',
    async (action, model, extra) => {
      await service.save(act({ action, ...extra }), at);

      expect(prisma[model].createMany).toHaveBeenCalledTimes(1);
      const { data, skipDuplicates } =
        prisma[model].createMany.mock.calls[0][0];
      expect(skipDuplicates).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ id: 'a1', createdAt: at });
      for (const other of [
        'productView',
        'searchQuery',
        'recommendationEvent',
        'shopperActivity',
      ].filter((m) => m !== model)) {
        expect(prisma[other].createMany).not.toHaveBeenCalled();
      }
    },
  );

  it('stores a batch with one insert per table, each row at its own time', async () => {
    const later = new Date(at.getTime() + 1000);
    await service.saveMany([
      { activity: act({ id: 'v1' }), occurredAt: at },
      { activity: act({ id: 'v2' }), occurredAt: later },
      {
        activity: act({ id: 's1', action: 'searched', query: 'q' }),
        occurredAt: at,
      },
    ]);

    expect(prisma.productView.createMany).toHaveBeenCalledTimes(1);
    expect(
      prisma.productView.createMany.mock.calls[0][0].data.map((r: any) => [
        r.id,
        r.createdAt,
      ]),
    ).toEqual([
      ['v1', at],
      ['v2', later],
    ]);
    expect(prisma.searchQuery.createMany).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty batch', async () => {
    await service.saveMany([]);

    expect(prisma.productView.createMany).not.toHaveBeenCalled();
  });

  describe('a row that points at something deleted', () => {
    it('keeps a product view as an anonymous visitor', async () => {
      prisma.productView.createMany
        .mockRejectedValueOnce(missingRow())
        .mockResolvedValueOnce({ count: 1 });

      await service.save(act({ visitorId: null }), at);

      expect(
        prisma.productView.createMany.mock.calls[1][0].data[0],
      ).toMatchObject({
        id: 'a1',
        userId: null,
        visitorId: 'visitor:u1',
      });
    });

    it('keeps the visitor it already had', async () => {
      prisma.productView.createMany
        .mockRejectedValueOnce(missingRow())
        .mockResolvedValueOnce({ count: 1 });

      await service.save(act({ visitorId: 'vis' }), at);

      expect(
        prisma.productView.createMany.mock.calls[1][0].data[0],
      ).toMatchObject({
        userId: null,
        visitorId: 'vis',
      });
    });

    it('drops it for any other kind, without failing', async () => {
      prisma.shopperActivity.createMany.mockRejectedValue(missingRow());

      await expect(
        service.save(act({ action: 'cart_item_added' }), at),
      ).resolves.toBeUndefined();
    });

    it('keeps the good rows of a batch when one is bad', async () => {
      prisma.recommendationEvent.createMany
        .mockRejectedValueOnce(missingRow()) // the batch
        .mockResolvedValueOnce({ count: 1 }) // r1
        .mockRejectedValueOnce(missingRow()); // r2 is the bad one
      const shelf = (id: string) =>
        act({ id, action: 'shelf_item_clicked', surface: 'HOME' });

      await expect(
        service.saveMany([
          { activity: shelf('r1'), occurredAt: at },
          { activity: shelf('r2'), occurredAt: at },
        ]),
      ).resolves.toBeUndefined();

      expect(prisma.recommendationEvent.createMany).toHaveBeenCalledTimes(3);
    });
  });

  it('throws any other storage error, so the caller can retry, and refreshes nothing', async () => {
    prisma.searchQuery.createMany.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(
      service.save(act({ action: 'searched', query: 'q' }), at),
    ).rejects.toThrow('connection lost');
    expect(refresh.schedule).not.toHaveBeenCalled();
  });

  describe('refreshing recommendations once the rows exist', () => {
    it('refreshes a signed-in shopper’s shelves and feed after a search or click', async () => {
      await service.save(
        act({ action: 'searched', query: 'q', visitorId: 'vis' }),
        at,
      );

      expect(refresh.schedule).toHaveBeenCalledWith(['u1', 's1', 'vis'], {
        userId: 'u1',
        sessionId: 's1',
        visitorId: 'vis',
      });
    });

    it('clears a guest’s cached shelves without rebuilding their feed', async () => {
      await service.save(
        act({ action: 'searched', query: 'q', userId: null }),
        at,
      );

      expect(refresh.schedule).toHaveBeenCalledWith(['s1'], undefined);
    });

    it('does not refresh for a product view, a store view or a cart change', async () => {
      await service.saveMany([
        { activity: act({}), occurredAt: at },
        { activity: act({ action: 'cart_item_added' }), occurredAt: at },
      ]);

      expect(refresh.schedule).not.toHaveBeenCalled();
    });
  });
});

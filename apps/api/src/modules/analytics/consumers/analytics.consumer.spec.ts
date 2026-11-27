import { Prisma } from '@prisma/client';
import { buildEnvelope } from '../../../infrastructure/messaging/events/event-envelope.util';
import { fakeRabbit } from '../../../infrastructure/messaging/rabbitmq/consumer-harness-spec';
import { RABBITMQ_QUEUES } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { AnalyticsConsumer } from './analytics.consumer';

const missingRow = () =>
  new Prisma.PrismaClientKnownRequestError('fk', {
    code: 'P2003',
    clientVersion: 'test',
  });

describe('AnalyticsConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let prisma: any;
  let refresh: { schedule: jest.Mock };
  let consumer: AnalyticsConsumer;

  const at = '2026-11-28T10:00:00.000Z';
  /** A shopper-activity message, as the publisher sends it: the action is the event name. */
  const activity = (action: string, body: object) =>
    buildEnvelope(
      {
        type: `shopper.${action}`,
        aggregate: { type: 'shopper', id: 'u1' },
        payload: body,
        occurredAt: new Date(at),
      },
      { eventId: 'e-1' },
    );

  beforeEach(() => {
    harness = fakeRabbit();
    const table = () => ({
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    });
    prisma = {
      productView: table(),
      searchQuery: table(),
      recommendationEvent: table(),
      marketplaceEvent: table(),
    };
    refresh = { schedule: jest.fn() };
    consumer = new AnalyticsConsumer(harness.rabbit, prisma, refresh as never);
    jest
      .spyOn((consumer as any).logger, 'error')
      .mockImplementation(() => undefined);
    jest
      .spyOn((consumer as any).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  async function handle(raw: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.ANALYTICS)(raw);
  }

  describe('shopper.product_viewed', () => {
    const viewed = (body: object = {}) =>
      activity('product_viewed', {
        id: 'view-1',
        productId: 'p1',
        userId: 'u1',
        visitorId: 'v1',
        sessionId: 's1',
        ...body,
      });

    it('stores the view under the id the producer chose, at the time it happened, skipping duplicates', async () => {
      await handle(viewed());

      expect(prisma.productView.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'view-1',
            productId: 'p1',
            userId: 'u1',
            visitorId: 'v1',
            sessionId: 's1',
            createdAt: new Date(at),
          },
        ],
        skipDuplicates: true,
      });
    });

    it('does not refresh the feed: a view does not change what to recommend', async () => {
      await handle(viewed());

      expect(refresh.schedule).not.toHaveBeenCalled();
    });

    it('when the user no longer exists, keeps the view as an anonymous visitor', async () => {
      prisma.productView.createMany
        .mockRejectedValueOnce(missingRow())
        .mockResolvedValueOnce({ count: 1 });

      await handle(viewed({ visitorId: null }));

      expect(
        prisma.productView.createMany.mock.calls[1][0].data[0],
      ).toMatchObject({
        id: 'view-1',
        userId: null,
        visitorId: 'visitor:u1',
      });
    });

    it('rethrows any other storage error so the queue can retry it', async () => {
      prisma.productView.createMany.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(handle(viewed())).rejects.toThrow('connection lost');
    });
  });

  describe('shopper.searched', () => {
    const searched = (body: object = {}) =>
      activity('searched', {
        id: 'search-1',
        query: 'red shoes',
        resultsCount: 4,
        userId: 'u1',
        sessionId: 's1',
        visitorId: 'v1',
        ...body,
      });

    it('stores it under its id, then refreshes that shopper’s feed once', async () => {
      await handle(searched());

      expect(prisma.searchQuery.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'search-1',
            query: 'red shoes',
            resultsCount: 4,
            userId: 'u1',
            sessionId: 's1',
            createdAt: new Date(at),
          },
        ],
        skipDuplicates: true,
      });
      expect(refresh.schedule).toHaveBeenCalledWith(['u1', 's1', 'v1'], {
        userId: 'u1',
        sessionId: 's1',
        visitorId: 'v1',
      });
    });

    it('clears a guest’s cached shelves but does not rebuild their feed', async () => {
      await handle(searched({ userId: null }));

      expect(refresh.schedule).toHaveBeenCalledWith(['s1', 'v1'], undefined);
    });

    it('does not refresh the feed when the row could not be stored', async () => {
      prisma.searchQuery.createMany.mockRejectedValue(new Error('db down'));

      await expect(handle(searched())).rejects.toThrow('db down');
      expect(refresh.schedule).not.toHaveBeenCalled();
    });
  });

  describe('what a shopper did with a recommendation shelf', () => {
    const shelf = (action: string, body: object = {}) =>
      activity(action, {
        id: 'r1',
        surface: 'HOME_FOR_YOU',
        productId: 'p1',
        requestId: 'req-1',
        rankerVersion: 'v3',
        position: 2,
        userId: 'u1',
        sessionId: 's1',
        ...body,
      });

    it.each([
      ['shelf_item_seen', 'IMPRESSION', false],
      ['shelf_item_clicked', 'CLICK', true],
      ['shelf_item_dismissed', 'DISMISS', true],
    ])(
      '%s is stored as %s; refreshing the feed: %s',
      async (action, label, refreshes) => {
        await handle(shelf(action));

        expect(prisma.recommendationEvent.createMany).toHaveBeenCalledWith({
          data: [
            {
              id: 'r1',
              eventType: label,
              surface: 'HOME_FOR_YOU',
              requestId: 'req-1',
              rankerVersion: 'v3',
              position: 2,
              productId: 'p1',
              vendorId: null,
              categoryId: null,
              userId: 'u1',
              sessionId: 's1',
              createdAt: new Date(at),
            },
          ],
          skipDuplicates: true,
        });
        expect(refresh.schedule).toHaveBeenCalledTimes(refreshes ? 1 : 0);
      },
    );

    it('stores a category view and refreshes the feed', async () => {
      await handle(
        shelf('category_viewed', { productId: null, categoryId: 'c1' }),
      );

      expect(
        prisma.recommendationEvent.createMany.mock.calls[0][0].data[0],
      ).toMatchObject({ eventType: 'CATEGORY_VIEW', categoryId: 'c1' });
      expect(refresh.schedule).toHaveBeenCalledTimes(1);
    });

    it('drops an interaction that points at a row that no longer exists', async () => {
      prisma.recommendationEvent.createMany.mockRejectedValue(missingRow());

      await expect(
        handle(shelf('shelf_item_clicked')),
      ).resolves.toBeUndefined();
    });

    it('rethrows any other storage error so the queue retries it, without refreshing', async () => {
      prisma.recommendationEvent.createMany.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(handle(shelf('shelf_item_clicked'))).rejects.toThrow(
        'connection lost',
      );
      expect(refresh.schedule).not.toHaveBeenCalled();
    });
  });

  describe('a store viewed, a cart change, a wishlist change', () => {
    const cart = {
      id: 'a2',
      productId: 'p1',
      vendorId: 'v1',
      cartId: 'c1',
      userId: 'u1',
      quantity: 2,
      surface: 'CART',
    };
    const wish = {
      id: 'a4',
      productId: 'p1',
      vendorId: 'v1',
      userId: 'u1',
      surface: 'WISHLIST',
    };

    it.each([
      [
        'store_viewed',
        { id: 'a1', vendorId: 'v1', userId: 'u1', surface: 'VENDOR_STORE' },
        'STORE_VIEW',
        { id: 'a1', vendorId: 'v1', productId: null },
      ],
      [
        'cart_item_added',
        cart,
        'CART_ADD',
        { id: 'a2', productId: 'p1', cartId: 'c1', quantity: 2 },
      ],
      [
        'cart_item_removed',
        { ...cart, id: 'a3' },
        'CART_REMOVE',
        { id: 'a3', productId: 'p1', quantity: 2 },
      ],
      [
        'wishlist_item_added',
        wish,
        'WISHLIST_ADD',
        { id: 'a4', productId: 'p1', quantity: 1 },
      ],
      [
        'wishlist_item_removed',
        { ...wish, id: 'a5' },
        'WISHLIST_REMOVE',
        { id: 'a5', productId: 'p1', quantity: 1 },
      ],
    ])(
      '%s becomes one row, under its id, at the time it happened',
      async (action, body, rowType, expected) => {
        await handle(activity(action, body));

        expect(prisma.marketplaceEvent.createMany).toHaveBeenCalledTimes(1);
        const { data, skipDuplicates } =
          prisma.marketplaceEvent.createMany.mock.calls[0][0];
        expect(skipDuplicates).toBe(true);
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({
          ...expected,
          eventType: rowType,
          createdAt: new Date(at),
        });
        expect(refresh.schedule).not.toHaveBeenCalled();
      },
    );

    it('drops activity that references a deleted user or product instead of poisoning the queue', async () => {
      prisma.marketplaceEvent.createMany.mockRejectedValue(missingRow());

      await expect(
        handle(activity('cart_item_added', cart)),
      ).resolves.toBeUndefined();
    });

    it('rethrows any other storage error so the queue retries it', async () => {
      prisma.marketplaceEvent.createMany.mockRejectedValue(new Error('down'));

      await expect(handle(activity('cart_item_added', cart))).rejects.toThrow(
        'down',
      );
    });
  });

  describe('messages it must not store', () => {
    it.each([
      ['not an envelope', { whatever: true }],
      [
        'a type this queue does not handle',
        buildEnvelope(
          {
            type: 'order.shipped',
            aggregate: { type: 'o', id: '1' },
            payload: {},
          },
          { eventId: 'e-2' },
        ),
      ],
      [
        'a payload version it cannot read',
        {
          ...activity('product_viewed', { id: 'v', productId: 'p' }),
          version: 9,
        },
      ],
      ['a view with no product', activity('product_viewed', { id: 'v' })],
      ['a search with no text', activity('searched', { id: 's' })],
      ['a store view with no store', activity('store_viewed', { id: 's' })],
    ])('dead-letters %s at once', async (_label, raw) => {
      await expect(handle(raw)).rejects.toMatchObject({
        name: 'PermanentConsumerError',
      });
      expect(prisma.productView.createMany).not.toHaveBeenCalled();
      expect(prisma.searchQuery.createMany).not.toHaveBeenCalled();
    });
  });

  describe('messages from the previous release (the old `type` field)', () => {
    it('still stores an old product_view', async () => {
      await handle({
        type: 'product_view',
        id: 'old-1',
        productId: 'p1',
        userId: 'u1',
        timestamp: at,
      });

      expect(
        prisma.productView.createMany.mock.calls[0][0].data[0],
      ).toMatchObject({
        id: 'old-1',
        productId: 'p1',
        createdAt: new Date(at),
      });
    });

    it('still stores an old search, shelf batch and marketplace event, each interaction on its own', async () => {
      await handle({
        type: 'search',
        id: 's-old',
        query: 'shoes',
        userId: 'u1',
      });
      await handle({
        type: 'recommendation_events',
        events: [
          { id: 'r1', eventType: 'CLICK', surface: 'HOME_FOR_YOU' },
          { id: 'r2', eventType: 'IMPRESSION', surface: 'HOME_FOR_YOU' },
        ],
      });
      await handle({
        type: 'marketplace_event',
        event: { id: 'm1', eventType: 'CART_ADD', productId: 'p1' },
      });

      expect(prisma.searchQuery.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.recommendationEvent.createMany).toHaveBeenCalledTimes(2);
      expect(prisma.marketplaceEvent.createMany).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['no body at all', undefined],
      ['a view without a product', { type: 'product_view' }],
      ['a search without a query', { type: 'search' }],
      ['an old type nobody handles', { type: 'other', productId: 'p1' }],
    ])(
      'acknowledges %s without storing anything, as before',
      async (_label, raw) => {
        await expect(handle(raw)).resolves.toBeUndefined();
        expect(prisma.productView.createMany).not.toHaveBeenCalled();
        expect(prisma.searchQuery.createMany).not.toHaveBeenCalled();
      },
    );
  });
});

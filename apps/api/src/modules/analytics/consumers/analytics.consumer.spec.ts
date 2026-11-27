import { Prisma } from '@prisma/client';
import { productViewEventId } from '@api/common/utils/product-view-event-id.util';
import { RABBITMQ_QUEUES } from '../../../infrastructure/messaging/rabbitmq/rabbitmq.constants';
import { AnalyticsConsumer } from './analytics.consumer';
import { fakeRabbit } from '../../../infrastructure/messaging/rabbitmq/consumer-harness-spec';

const fkViolation = () =>
  new Prisma.PrismaClientKnownRequestError('fk', {
    code: 'P2003',
    clientVersion: 't',
  });

describe('AnalyticsConsumer', () => {
  let harness: ReturnType<typeof fakeRabbit>;
  let prisma: any;
  let consumer: AnalyticsConsumer;
  let refresh: { schedule: jest.Mock };

  beforeEach(() => {
    harness = fakeRabbit();
    prisma = {
      productView: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      searchQuery: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      recommendationEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      marketplaceEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    refresh = { schedule: jest.fn() };
    consumer = new AnalyticsConsumer(harness.rabbit, prisma, refresh as never);
    jest
      .spyOn((consumer as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  async function handle(payload: unknown) {
    await consumer.onModuleInit();
    return harness.handlerFor(RABBITMQ_QUEUES.ANALYTICS)(payload);
  }

  it('stores a product view under the id the producer chose, skipping duplicates', async () => {
    await handle({
      type: 'product_view',
      id: 'evt-1',
      productId: 'p1',
      userId: 'u1',
      sessionId: 's1',
      timestamp: '2026-11-01T10:00:00.000Z',
    });

    expect(prisma.productView.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: 'evt-1',
          productId: 'p1',
          userId: 'u1',
          visitorId: null,
          sessionId: 's1',
          createdAt: new Date('2026-11-01T10:00:00.000Z'),
        },
      ],
      skipDuplicates: true,
    });
  });

  it('derives a stable id when the producer sent none, so a redelivery is a duplicate', async () => {
    const payload = {
      type: 'product_view',
      productId: 'p1',
      visitorId: 'v1',
      timestamp: '2026-11-01T10:00:00.000Z',
    };

    await handle(payload);

    const expected = productViewEventId({
      productId: 'p1',
      userId: undefined,
      visitorId: 'v1',
      sessionId: undefined,
      timestamp: payload.timestamp,
    });
    expect(prisma.productView.createMany.mock.calls[0][0].data[0].id).toBe(
      expected,
    );
  });

  it('when the user no longer exists, keeps the view as an anonymous visitor', async () => {
    prisma.productView.createMany
      .mockRejectedValueOnce(fkViolation())
      .mockResolvedValueOnce({ count: 1 });

    await handle({ type: 'product_view', productId: 'p1', userId: 'gone' });

    expect(prisma.productView.createMany).toHaveBeenCalledTimes(2);
    const retry = prisma.productView.createMany.mock.calls[1][0].data[0];
    expect(retry.userId).toBeNull();
    expect(retry.visitorId).toBe('visitor:gone');
  });

  it('rethrows any other storage error so the broker can retry it', async () => {
    prisma.productView.createMany.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(
      handle({ type: 'product_view', productId: 'p1' }),
    ).rejects.toThrow('connection lost');
  });

  it('stores a search with zero results when the count is missing', async () => {
    await handle({
      type: 'search',
      query: 'red shoes',
      userId: 'u1',
      sessionId: 's1',
    });

    expect(prisma.searchQuery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          query: 'red shoes',
          resultsCount: 0,
          userId: 'u1',
          sessionId: 's1',
        }),
      ],
      skipDuplicates: true,
    });
  });

  describe('search with a producer-assigned id and a feed refresh', () => {
    it('stores it under that id, so a redelivery is a no-op, then refreshes the feed once', async () => {
      await handle({
        type: 'search',
        id: 'search-1',
        query: 'red shoes',
        resultsCount: 4,
        userId: 'u1',
        refreshFor: ['u1', 's1'],
      });

      expect(prisma.searchQuery.createMany.mock.calls[0][0].data[0].id).toBe(
        'search-1',
      );
      expect(refresh.schedule).toHaveBeenCalledWith('u1', 's1');
    });

    it('does not refresh the feed when the row could not be stored', async () => {
      prisma.searchQuery.createMany.mockRejectedValue(new Error('db down'));

      await expect(
        handle({ type: 'search', query: 'x', refreshFor: ['u1'] }),
      ).rejects.toThrow('db down');
      expect(refresh.schedule).not.toHaveBeenCalled();
    });
  });

  describe('recommendation events', () => {
    const events = [
      { id: 'r1', eventType: 'CLICK', surface: 'HOME', productId: 'p1' },
      { id: 'r2', eventType: 'IMPRESSION', surface: 'HOME', productId: 'p2' },
    ];

    it('stores the whole batch at once, skipping duplicates, then refreshes the feed once', async () => {
      await handle({
        type: 'recommendation_events',
        events,
        refreshFor: ['u1', 's1'],
      });

      expect(prisma.recommendationEvent.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.recommendationEvent.createMany).toHaveBeenCalledWith({
        data: events,
        skipDuplicates: true,
      });
      expect(refresh.schedule).toHaveBeenCalledWith('u1', 's1');
    });

    it('keeps the good events when one points at a row that no longer exists', async () => {
      const missing = new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
      });
      prisma.recommendationEvent.createMany
        .mockRejectedValueOnce(missing) // the batch
        .mockResolvedValueOnce({ count: 1 }) // r1
        .mockRejectedValueOnce(missing); // r2 is the bad one

      await expect(
        handle({ type: 'recommendation_events', events, refreshFor: [] }),
      ).resolves.toBeUndefined();

      expect(prisma.recommendationEvent.createMany).toHaveBeenCalledTimes(3);
    });

    it('rethrows any other storage error so the queue retries the batch', async () => {
      prisma.recommendationEvent.createMany.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        handle({ type: 'recommendation_events', events }),
      ).rejects.toThrow('connection lost');
      expect(refresh.schedule).not.toHaveBeenCalled();
    });

    it('ignores an empty batch', async () => {
      await handle({ type: 'recommendation_events', events: [] });

      expect(prisma.recommendationEvent.createMany).not.toHaveBeenCalled();
    });
  });

  describe('marketplace events', () => {
    const event = {
      id: 'm1',
      eventType: 'CART_ADD',
      productId: 'p1',
      userId: 'u1',
      quantity: 2,
    };

    it('stores the event under its id, skipping duplicates', async () => {
      await handle({
        type: 'marketplace_event',
        event,
        timestamp: '2026-11-28T10:00:00.000Z',
      });

      expect(prisma.marketplaceEvent.createMany).toHaveBeenCalledWith({
        data: [{ ...event, createdAt: new Date('2026-11-28T10:00:00.000Z') }],
        skipDuplicates: true,
      });
    });

    it('drops an event that references a deleted user or product instead of poisoning the queue', async () => {
      prisma.marketplaceEvent.createMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('fk', {
          code: 'P2003',
          clientVersion: 'test',
        }),
      );

      await expect(
        handle({ type: 'marketplace_event', event }),
      ).resolves.toBeUndefined();
    });

    it('rethrows any other storage error', async () => {
      prisma.marketplaceEvent.createMany.mockRejectedValue(new Error('down'));

      await expect(
        handle({ type: 'marketplace_event', event }),
      ).rejects.toThrow('down');
    });
  });

  it.each([
    ['no payload', undefined],
    ['a view without a product', { type: 'product_view' }],
    ['a search without a query', { type: 'search' }],
    ['an unknown type', { type: 'other', productId: 'p1' }],
  ])('ignores %s', async (_label, payload) => {
    await expect(handle(payload)).resolves.toBeUndefined();
    expect(prisma.productView.createMany).not.toHaveBeenCalled();
    expect(prisma.searchQuery.createMany).not.toHaveBeenCalled();
    expect(prisma.recommendationEvent.createMany).not.toHaveBeenCalled();
    expect(prisma.marketplaceEvent.createMany).not.toHaveBeenCalled();
  });
});
